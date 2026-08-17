const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('../models/db');
const { generateToken, authenticate } = require('../middleware/auth');

const router = express.Router();

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password, surname, reg_number, staff_id } = req.body;

    const db = getDB();
    let user;

    // STAFF ID LOGIN
    if (staff_id) {
      const cleanId = staff_id.toString().trim();

      const [users] = await db.execute(
        `SELECT * FROM users WHERE staff_id = ? AND is_active = TRUE`,
        [cleanId]
      );

      if (!users[0]) {
        return res.status(401).json({
          error: 'Staff ID not found'
        });
      }

      if (surname) {
        const stored = users[0].full_name
          .trim()
          .split(' ')[0]
          .toLowerCase();

        if (stored !== surname.trim().toLowerCase()) {
          return res.status(401).json({
            error: 'Staff ID and surname do not match'
          });
        }
      }

      user = users[0];
    }

    // STUDENT LOGIN
    else if (surname && !email) {

      const cleanSurname = surname
        .toString()
        .trim()
        .toLowerCase();

      const [users] = await db.execute(
        `SELECT * FROM users
         WHERE LOWER(SUBSTRING_INDEX(full_name, ' ', 1)) = ?
         AND role = 'candidate'
         AND is_active = TRUE`,
        [cleanSurname]
      );

      if (users.length === 0) {
        return res.status(401).json({
          error: 'Surname not found'
        });
      }

      if (users.length > 1) {

        if (!reg_number) {
          return res.status(409).json({
            error: 'Multiple students found. Enter registration number.',
            requires_reg_number: true
          });
        }

        const matched = users.find(
          u => u.reg_number === reg_number.toString().trim()
        );

        if (!matched) {
          return res.status(401).json({
            error: 'Surname and registration number do not match'
          });
        }

        user = matched;

      } else {
        user = users[0];
      }
    }

    // ADMIN / STAFF EMAIL LOGIN
    else if (email) {

      if (!password) {
        return res.status(400).json({
          error: 'Password is required'
        });
      }

      // DEVELOPMENT FALLBACK ADMIN
      if (
        email.toLowerCase().trim() === 'admin@examos.com' &&
        password === 'password'
      ) {

        user = {
          id: uuidv4(),
          email: 'admin@examos.com',
          full_name: 'Super Admin',
          role: 'superadmin',
          is_active: true
        };

      } else {

        const [users] = await db.execute(
          'SELECT * FROM users WHERE email = ? AND is_active = TRUE',
          [email.toLowerCase().trim()]
        );

        if (!users[0]) {
          return res.status(401).json({
            error: 'Invalid credentials'
          });
        }

        const valid = await bcrypt.compare(
          password,
          users[0].password_hash
        );

        if (!valid) {
          return res.status(401).json({
            error: 'Invalid credentials'
          });
        }

        user = users[0];
      }
    }

    else {
      return res.status(400).json({
        error: 'Enter surname, email or staff ID'
      });
    }

    // UPDATE LAST LOGIN
    if (user.id) {
      try {
        await db.execute(
          'UPDATE users SET last_login = NOW() WHERE id = ?',
          [user.id]
        );
      } catch (e) {
        console.log('Skipping last_login update');
      }
    }

    const token = generateToken(user);

    const safeUser = {
      id: user.id,
      email: user.email,
      full_name: user.full_name,
      role: user.role
    };

    res.json({
      token,
      user: safeUser
    });

  } catch (err) {

    console.error('LOGIN ERROR:', err);

    res.status(500).json({
      error: err.message
    });
  }
});

// REGISTER
router.post('/register', async (req, res) => {
  try {

    const {
      email,
      password,
      full_name,
      role = 'candidate'
    } = req.body;

    if (!email || !password || !full_name) {
      return res.status(400).json({
        error: 'All fields required'
      });
    }

    const db = getDB();

    const [existing] = await db.execute(
      'SELECT id FROM users WHERE email = ?',
      [email.toLowerCase()]
    );

    if (existing[0]) {
      return res.status(409).json({
        error: 'Email already exists'
      });
    }

    const hash = await bcrypt.hash(password, 10);

    const id = uuidv4();

    await db.execute(
      'INSERT INTO users (id,email,password_hash,full_name,role) VALUES (?,?,?,?,?)',
      [
        id,
        email.toLowerCase().trim(),
        hash,
        full_name,
        role
      ]
    );

    const token = generateToken({
      id,
      email,
      full_name,
      role
    });

    res.status(201).json({
      token,
      user: {
        id,
        email,
        full_name,
        role
      }
    });

  } catch (err) {

    console.error(err);

    res.status(500).json({
      error: 'Registration failed'
    });
  }
});

// CURRENT USER
router.get('/me', authenticate, async (req, res) => {
  res.json({
    user: req.user
  });
});

// CHANGE PASSWORD
router.put('/password', authenticate, async (req, res) => {
  try {

    const {
      current_password,
      new_password
    } = req.body;

    const db = getDB();

    const [users] = await db.execute(
      'SELECT password_hash FROM users WHERE id = ?',
      [req.user.id]
    );

    const valid = await bcrypt.compare(
      current_password,
      users[0].password_hash
    );

    if (!valid) {
      return res.status(400).json({
        error: 'Current password incorrect'
      });
    }

    const hash = await bcrypt.hash(new_password, 10);

    await db.execute(
      'UPDATE users SET password_hash = ? WHERE id = ?',
      [hash, req.user.id]
    );

    res.json({
      message: 'Password updated'
    });

  } catch (err) {

    res.status(500).json({
      error: 'Failed to update password'
    });
  }
});

module.exports = router;