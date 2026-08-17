const express = require('express');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const { getDB } = require('../models/db');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY || '';
const PAYSTACK_PUBLIC = process.env.PAYSTACK_PUBLIC_KEY || '';

// ── Ensure payments table ─────────────────────────────────────
async function ensurePaymentsTables(db) {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS payments (
      id VARCHAR(36) PRIMARY KEY,
      user_id VARCHAR(36) NOT NULL,
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

// ── POST /api/payments/initialize ─────────────────────────────
router.post('/initialize', authenticate, async (req, res) => {
  try {
    const db = getDB();
    await ensurePaymentsTables(db);

    const { email, amount, metadata } = req.body;
    if (!email || !amount) return res.status(400).json({ error: 'email and amount required' });

    const reference = `EXAMOS-${Date.now()}-${uuidv4().slice(0,8).toUpperCase()}`;

    // Save pending payment
    await db.execute(
      `INSERT INTO payments (id, user_id, reference, amount, plan_id, plan_name, status)
       VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
      [uuidv4(), req.user.id, reference, amount, metadata?.plan_id || null, metadata?.plan_name || null]
    );

    res.json({ reference, public_key: PAYSTACK_PUBLIC });
  } catch (err) {
    console.error('payment initialize error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/payments/verify ─────────────────────────────────
router.post('/verify', authenticate, async (req, res) => {
  try {
    const db = getDB();
    await ensurePaymentsTables(db);

    const { reference } = req.body;
    if (!reference) return res.status(400).json({ error: 'reference required' });

    // Verify with Paystack
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
      } catch (e) {
        console.error('Paystack verify error:', e.message);
      }
    } else {
      // Dev mode — auto-verify
      verified = true;
      console.warn('⚠ PAYSTACK_SECRET_KEY not set — running in dev mode, auto-verifying');
    }

    if (!verified) {
      await db.execute("UPDATE payments SET status='failed' WHERE reference=?", [reference]);
      return res.status(400).json({ error: 'Payment verification failed' });
    }

    // Get the payment record
    const [payments] = await db.execute('SELECT * FROM payments WHERE reference=?', [reference]);
    if (!payments[0]) return res.status(404).json({ error: 'Payment record not found' });
    const payment = payments[0];

    // Update payment status
    await db.execute(
      "UPDATE payments SET status='success', paystack_data=? WHERE reference=?",
      [JSON.stringify(paystackData), reference]
    );

    // Activate subscription (30 days)
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await db.execute(`
      INSERT INTO user_subscriptions (id, user_id, plan_id, plan_name, expires_at, payment_id)
      VALUES (?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE plan_id=?, plan_name=?, expires_at=?, payment_id=?
    `, [
      uuidv4(), req.user.id, payment.plan_id, payment.plan_name, expiresAt, payment.id,
      payment.plan_id, payment.plan_name, expiresAt, payment.id,
    ]);

    res.json({
      success: true,
      plan_id: payment.plan_id,
      plan_name: payment.plan_name,
      expires_at: expiresAt,
    });
  } catch (err) {
    console.error('payment verify error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

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

module.exports = router;
