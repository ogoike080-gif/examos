const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { getDB } = require('../models/db');

const JWT_SECRET = process.env.JWT_SECRET || 'examos-super-secret-key-2026';

// `sessionId` is the single-active-session mechanism (see
// models/db.js users.current_session_id, and startSession below for how
// it's generated/persisted). Optional so any existing caller that hasn't
// been updated to pass one yet still gets a working token — it just won't
// carry a `sid`, which authenticate() below treats the same as a stale
// pre-this-feature token (see the comment there).
function generateToken(user, sessionId) {
  const payload = { id: user.id, email: user.email, role: user.role };
  if (sessionId) payload.sid = sessionId;
  return jwt.sign(
    payload,
    JWT_SECRET,
    { expiresIn: '7d' }  // Changed from 24h to 7 days
  );
}

// Generates a new session id, persists it as this user's ONLY current
// session, and returns it for the caller to embed in generateToken(). Call
// this exactly once per successful login/signup (routes/auth.js /login and
// /register, routes/payments.js finalizePayment's anonymous-checkout
// auto-login) — never on every request, just at the moment a new session
// actually starts. Overwriting the column is the entire mechanism: any
// token issued for an OLDER session — including one still sitting valid in
// someone else's browser right now — stops matching this column the
// instant this runs, so that browser's very next request gets rejected by
// authenticate() below. This is what "no two people can be logged into the
// same account at once" actually means here: not a device limit, just
// "whoever logged in most recently is the only valid session."
async function startSession(db, userId) {
  const sessionId = crypto.randomBytes(24).toString('hex');
  await db.execute('UPDATE users SET current_session_id=? WHERE id=?', [sessionId, userId]);
  return sessionId;
}

async function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);

    const db = getDB();
    const [users] = await db.execute(
      'SELECT id, email, full_name, role, is_active, reg_number, class_name, current_session_id FROM users WHERE id = ?',
      [decoded.id]
    );

    if (!users[0] || !users[0].is_active) {
      return res.status(401).json({ error: 'Account not found or inactive' });
    }

    // A token with no `sid` at all is either issued before this feature
    // existed, or from a code path that hasn't been updated to call
    // startSession() yet — treat it the same as a superseded session
    // rather than quietly trusting it forever: everyone gets one clean
    // re-login the first time this deploys, which is what actually
    // establishes their unique session going forward.
    if (!decoded.sid || decoded.sid !== users[0].current_session_id) {
      return res.status(401).json({
        error: 'This account was signed in elsewhere — you have been logged out here.',
        code: 'SESSION_SUPERSEDED',
      });
    }

    req.user = users[0];
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Like authenticate, but never rejects — sets req.user if a valid token is
// present, otherwise leaves it null and lets the request through anyway.
// Used for routes that need to work for a signed-in user AND an anonymous
// visitor at the same time (GET /api/questions, so "Practice Free" can
// serve the first 5 free questions without forcing a login first — see the
// anon-id/user-id-based quota check there).
//
// A session that's been superseded elsewhere is treated as anonymous here,
// not rejected — this route already has its own anonymous-visitor handling
// (the free-trial quota), so falling back to that is the graceful outcome,
// not an error page. Any route that actually needs a confirmed identity
// uses authenticate() above instead, which does reject a superseded session.
async function optionalAuthenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) { req.user = null; return next(); }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);

    const db = getDB();
    const [users] = await db.execute(
      'SELECT id, email, full_name, role, is_active, reg_number, class_name, current_session_id FROM users WHERE id = ?',
      [decoded.id]
    );

    const sessionValid = decoded.sid && users[0] && decoded.sid === users[0].current_session_id;
    req.user = (users[0] && users[0].is_active && sessionValid) ? users[0] : null;
    next();
  } catch (err) {
    req.user = null; // invalid/expired token — treat as anonymous rather than rejecting
    next();
  }
}

function authorize(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user?.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

module.exports = { authenticate, optionalAuthenticate, authorize, generateToken, startSession, JWT_SECRET };
