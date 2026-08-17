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

function authorize(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user?.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

module.exports = { authenticate, authorize, generateToken, JWT_SECRET };