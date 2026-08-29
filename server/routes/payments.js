const express = require('express');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const { getDB } = require('../models/db');
const bcrypt = require('bcryptjs');
const { authenticate, optionalAuthenticate, generateToken } = require('../middleware/auth');

const router = express.Router();

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY || '';
const PAYSTACK_PUBLIC = process.env.PAYSTACK_PUBLIC_KEY || '';
const IS_PROD = process.env.NODE_ENV === 'production';

// Canonical source of truth for what each plan actually costs — must match
// the PLANS array in client/src/pages/candidate/PaystackPayment.jsx. Kept
// server-side and checked on both initialize and verify so the amount a
// student is charged (and the plan they get activated into) can't be
// tampered with by editing the request — the client-sent amount/plan_id
// were previously trusted as-is.
const PLANS = {
  free:    { name: 'Free',    price: 0 },
  student: { name: 'Student', price: 500 },
  school:  { name: 'School',  price: 5000 },
};

// ── Ensure payments table ─────────────────────────────────────
async function ensurePaymentsTables(db) {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS payments (
      id VARCHAR(36) PRIMARY KEY,
      user_id VARCHAR(36) NULL,
      pending_full_name VARCHAR(255) NULL,
      pending_email VARCHAR(255) NULL,
      reference VARCHAR(100) UNIQUE NOT NULL,
      amount DECIMAL(10,2) NOT NULL,
      plan_id VARCHAR(50),
      plan_name VARCHAR(100),
      status ENUM('pending','success','failed') DEFAULT 'pending',
      paystack_data JSON,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);
  // Widen an already-existing table from before anonymous checkout existed,
  // where user_id was NOT NULL — an anonymous payment has no user yet at
  // the point the payment row is created (see /initialize), only once it's
  // confirmed (see finalizePayment). One-time, harmless if already applied.
  if (!tablesWidened) {
    tablesWidened = true;
    try { await db.execute(`ALTER TABLE payments MODIFY user_id VARCHAR(36) NULL`); } catch (e) {}
    try { await db.execute(`ALTER TABLE payments ADD COLUMN pending_full_name VARCHAR(255) NULL`); } catch (e) {}
    try { await db.execute(`ALTER TABLE payments ADD COLUMN pending_email VARCHAR(255) NULL`); } catch (e) {}
  }
  await db.execute(`
    CREATE TABLE IF NOT EXISTS user_subscriptions (
      id VARCHAR(36) PRIMARY KEY,
      user_id VARCHAR(36) NOT NULL UNIQUE,
      plan_id VARCHAR(50) DEFAULT 'free',
      plan_name VARCHAR(100) DEFAULT 'Free',
      expires_at DATETIME,
      payment_id VARCHAR(36),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);
}
let tablesWidened = false;

// Shared by /verify and the webhook — both end up doing the same thing once
// a payment is confirmed, so keeping it in one place means both paths stay
// consistent. Safe to call more than once for the same payment (e.g. the
// browser's /verify call AND the webhook both fire for one purchase): if
// it's already marked 'success', this is a no-op rather than re-processing.
//
// If this was an anonymous checkout (no account existed when they paid —
// see /initialize), the account is created right here, now that payment is
// actually confirmed — not before. That was a deliberate change: creating
// the account up front meant someone who backed out of Paystack's popup
// still ended up with a stray, subscription-less account. Now a cancelled
// or failed payment leaves no account behind at all.
async function finalizePayment(db, payment, paystackData) {
  if (payment.status === 'success') {
    return { alreadyProcessed: true };
  }

  let userId = payment.user_id;
  let newSession = null; // { token, user } — only set when an account was just created here

  if (!userId) {
    const password = crypto.randomBytes(16).toString('hex'); // never used to log in normally — see routes/candidates.js pattern
    const hash = await bcrypt.hash(password, 10);
    userId = uuidv4();
    const email = payment.pending_email;
    const fullName = payment.pending_full_name || email.split('@')[0];
    await db.execute(
      'INSERT INTO users (id,email,password_hash,full_name,role) VALUES (?,?,?,?,?)',
      [userId, email.toLowerCase().trim(), hash, fullName, 'candidate']
    );
    const token = generateToken({ id: userId, email, full_name: fullName, role: 'candidate' });
    newSession = { token, user: { id: userId, email, full_name: fullName, role: 'candidate' } };
  }

  await db.execute(
    "UPDATE payments SET status='success', user_id=?, paystack_data=? WHERE id=?",
    [userId, JSON.stringify(paystackData), payment.id]
  );

  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  await db.execute(`
    INSERT INTO user_subscriptions (id, user_id, plan_id, plan_name, expires_at, payment_id)
    VALUES (?, ?, ?, ?, ?, ?)
    ON DUPLICATE KEY UPDATE plan_id=?, plan_name=?, expires_at=?, payment_id=?
  `, [
    uuidv4(), userId, payment.plan_id, payment.plan_name, expiresAt, payment.id,
    payment.plan_id, payment.plan_name, expiresAt, payment.id,
  ]);

  return { alreadyProcessed: false, expiresAt, newSession };
}

// ── POST /api/payments/initialize ─────────────────────────────
router.post('/initialize', optionalAuthenticate, async (req, res) => {
  try {
    const db = getDB();
    await ensurePaymentsTables(db);

    const { email, amount, metadata, full_name } = req.body || {};
    if (!email || !amount) return res.status(400).json({ error: 'email and amount required' });
    // Defensive check mirroring the client-side guard in PaystackPayment.jsx —
    // catches direct API calls too, and gives a clearer error than Paystack's
    // own "email must be a valid email" 400 from checkout/request_inline.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.endsWith('@ogotech.internal')) {
      return res.status(400).json({ error: 'A valid email is required for checkout' });
    }
    // An anonymous "Practice Free" visitor has no account yet — their name
    // is required now so the account can be created once payment actually
    // confirms (see finalizePayment), without a separate registration step.
    if (!req.user && !full_name?.trim()) {
      return res.status(400).json({ error: 'full_name is required for checkout without an account' });
    }

    // Reject up front if the plan+amount pair doesn't match what that plan
    // actually costs — stops someone initializing a "School" purchase for
    // ₦1 by editing the request before it ever reaches Paystack.
    const planId = metadata?.plan_id;
    const plan = PLANS[planId];
    if (!plan) return res.status(400).json({ error: `Unknown plan_id: ${planId}` });
    if (Number(amount) !== plan.price) {
      return res.status(400).json({ error: `Amount does not match the ${plan.name} plan price` });
    }

    if (!PAYSTACK_SECRET && IS_PROD) {
      return res.status(503).json({ error: 'Payments are not configured on this server yet — contact support.' });
    }

    const reference = `EXAMOS-${Date.now()}-${uuidv4().slice(0,8).toUpperCase()}`;

    await db.execute(
      `INSERT INTO payments (id, user_id, pending_full_name, pending_email, reference, amount, plan_id, plan_name, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
      [uuidv4(), req.user ? req.user.id : null, req.user ? null : full_name.trim(), req.user ? null : email, reference, amount, planId, plan.name]
    );

    res.json({ reference, public_key: PAYSTACK_PUBLIC });
  } catch (err) {
    console.error('payment initialize error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/payments/verify ─────────────────────────────────
// Fires from the browser right after Paystack's checkout closes. This is
// the fast path for immediate UI feedback ("You're upgraded!") — the
// webhook below is the durable path that still activates the subscription
// even if the student closes the tab before this call goes out.
router.post('/verify', optionalAuthenticate, async (req, res) => {
  try {
    const db = getDB();
    await ensurePaymentsTables(db);

    const { reference } = req.body || {};
    if (!reference) return res.status(400).json({ error: 'reference required' });

    const [payments] = await db.execute('SELECT * FROM payments WHERE reference=?', [reference]);
    if (!payments[0]) return res.status(404).json({ error: 'Payment record not found' });
    const payment = payments[0];

    let paystackData = null;
    let verified = false;

    if (PAYSTACK_SECRET) {
      try {
        const response = await axios.get(
          `https://api.paystack.co/transaction/verify/${reference}`,
          { headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` } }
        );
        paystackData = response.data.data;
        verified = paystackData?.status === 'success';

        // Confirm the amount actually paid (Paystack returns kobo) matches
        // what this plan costs — "success" only means the transaction it
        // was given went through, not that it was for the right amount.
        const expectedKobo = (PLANS[payment.plan_id]?.price ?? -1) * 100;
        if (verified && paystackData.amount !== expectedKobo) {
          console.error(`payment amount mismatch: reference=${reference} paid=${paystackData.amount} expected=${expectedKobo}`);
          verified = false;
        }
      } catch (e) {
        console.error('Paystack verify error:', e.message);
      }
    } else if (!IS_PROD) {
      // Dev mode only — never reachable in production, since /initialize
      // above already refuses to start a payment when PAYSTACK_SECRET is
      // unset and NODE_ENV=production.
      verified = true;
      console.warn('⚠ PAYSTACK_SECRET_KEY not set — running in dev mode, auto-verifying');
    }

    if (!verified) {
      await db.execute("UPDATE payments SET status='failed' WHERE reference=?", [reference]);
      return res.status(400).json({ error: 'Payment verification failed' });
    }

    const result = await finalizePayment(db, payment, paystackData);

    res.json({
      success: true,
      plan_id: payment.plan_id,
      plan_name: payment.plan_name,
      expires_at: result.expiresAt,
      // Only present when this payment created a brand-new account (an
      // anonymous "Practice Free" checkout) — the client uses this to log
      // the candidate straight in, so entering their name/email at checkout
      // doubles as signing up, with no separate registration step.
      new_session: result.newSession || null,
    });
  } catch (err) {
    console.error('payment verify error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/payments/webhook ─────────────────────────────────
// Registered directly in index.js with a raw-body parser (must run before
// the global express.json()) — see the comment there. This is the reliable
// activation path: Paystack calls this server-to-server regardless of
// whether the student's browser is still open, so a closed tab or dropped
// connection right after paying can no longer mean "paid but never
// upgraded". Verifies the request genuinely came from Paystack via the
// x-paystack-signature header before trusting anything in the body.
async function paystackWebhookHandler(req, res) {
  try {
    if (!PAYSTACK_SECRET) {
      console.error('Paystack webhook received but PAYSTACK_SECRET_KEY is not set — ignoring.');
      return res.status(503).end();
    }

    const signature = req.headers['x-paystack-signature'];
    const rawBody = req.body; // Buffer, thanks to express.raw() on this route
    const expectedSignature = crypto.createHmac('sha512', PAYSTACK_SECRET).update(rawBody).digest('hex');

    if (!signature || signature !== expectedSignature) {
      console.error('Paystack webhook signature mismatch — rejecting.');
      return res.status(401).end();
    }

    const event = JSON.parse(rawBody.toString('utf8'));
    // Acknowledge immediately — Paystack retries on non-2xx, and there's
    // nothing left for it to do once the signature has checked out.
    res.status(200).end();

    if (event.event !== 'charge.success') return;

    const data = event.data;
    const db = getDB();
    await ensurePaymentsTables(db);

    const [payments] = await db.execute('SELECT * FROM payments WHERE reference=?', [data.reference]);
    const payment = payments[0];
    if (!payment) {
      console.error(`Paystack webhook: no payment record for reference ${data.reference}`);
      return;
    }

    const expectedKobo = (PLANS[payment.plan_id]?.price ?? -1) * 100;
    if (data.amount !== expectedKobo) {
      console.error(`Paystack webhook amount mismatch: reference=${data.reference} paid=${data.amount} expected=${expectedKobo}`);
      return;
    }

    await finalizePayment(db, payment, data);
  } catch (err) {
    console.error('paystack webhook error:', err.message);
    // Response has already been sent above; nothing more to do.
  }
}

// ── GET /api/payments/history ─────────────────────────────────
router.get('/history', authenticate, async (req, res) => {
  try {
    const db = getDB();
    await ensurePaymentsTables(db);
    const [payments] = await db.execute(
      "SELECT * FROM payments WHERE user_id=? ORDER BY created_at DESC LIMIT 20",
      [req.user.id]
    );
    res.json({ payments });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/payments/subscription ───────────────────────────
router.get('/subscription', authenticate, async (req, res) => {
  try {
    const db = getDB();
    await ensurePaymentsTables(db);

    const [rows] = await db.execute(
      'SELECT * FROM user_subscriptions WHERE user_id=?', [req.user.id]
    );

    if (!rows[0] || (rows[0].expires_at && new Date(rows[0].expires_at) < new Date())) {
      return res.json({ plan_id:'free', plan_name:'Free', active:true });
    }

    res.json({
      plan_id: rows[0].plan_id,
      plan_name: rows[0].plan_name,
      expires_at: rows[0].expires_at,
      active: true,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.paystackWebhookHandler = paystackWebhookHandler;
module.exports = router;
