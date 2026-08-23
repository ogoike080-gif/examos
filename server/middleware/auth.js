const jwt = require('jsonwebtoken');
const { getDB } = require('../models/db');

const JWT_SECRET = process.env.JWT_SECRET || 'examos-super-secret-key-2026';

function generateToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: '7d' }  // Changed from 24h to 7 days
  );
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
      'SELECT id, email, full_name, role, is_active FROM users WHERE id = ?',
      [decoded.id]
    );

    if (!users[0] || !users[0].is_active) {
      return res.status(401).json({ error: 'Account not found or inactive' });
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
// visitor at the same time (currently just GET /api/questions, so the
// "Practice Free" flow can serve the first 5 free questions without forcing
// a login first — see the anon-id-based quota check there).
async function optionalAuthenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) { req.user = null; return next(); }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);

    const db = getDB();
    const [users] = await db.execute(
      'SELECT id, email, full_name, role, is_active FROM users WHERE id = ?',
      [decoded.id]
    );

    req.user = (users[0] && users[0].is_active) ? users[0] : null;
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

module.exports = { authenticate, optionalAuthenticate, authorize, generateToken, JWT_SECRET };