const express = require('express');
const { getDB } = require('../models/db');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();

// Ensure settings table exists
async function ensureSettingsTable() {
  const db = getDB();
  await db.execute(`
    CREATE TABLE IF NOT EXISTS school_settings (
      id INT PRIMARY KEY DEFAULT 1,
      school_name VARCHAR(255) DEFAULT 'Ogotech Conventional/Technical School',
      school_short_name VARCHAR(100) DEFAULT 'Ogotech',
      school_motto VARCHAR(255) DEFAULT 'Excellence Through Knowledge and Skills',
      school_address TEXT,
      school_phone VARCHAR(100),
      school_email VARCHAR(255),
      school_website VARCHAR(255),
      school_logo_url VARCHAR(500),
      result_footer TEXT,
      result_color VARCHAR(20) DEFAULT '#1A6BFF',
      result_show_position BOOLEAN DEFAULT FALSE,
      result_show_class BOOLEAN DEFAULT TRUE,
      result_show_teacher_comment BOOLEAN DEFAULT TRUE,
      result_grading_system JSON,
      principal_name VARCHAR(255),
      principal_title VARCHAR(100) DEFAULT 'Principal',
      exam_officer_name VARCHAR(255),
      stamp_text VARCHAR(255) DEFAULT 'OFFICIAL RESULT',
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  const [rows] = await db.execute('SELECT id FROM school_settings WHERE id = 1');
  if (rows.length === 0) {
    const defaultGrading = JSON.stringify([
      { min: 90, max: 100, grade: 'A1', remark: 'Excellent' },
      { min: 80, max: 89,  grade: 'B2', remark: 'Very Good' },
      { min: 75, max: 79,  grade: 'B3', remark: 'Good' },
      { min: 70, max: 74,  grade: 'C4', remark: 'Credit' },
      { min: 65, max: 69,  grade: 'C5', remark: 'Credit' },
      { min: 60, max: 64,  grade: 'C6', remark: 'Credit' },
      { min: 55, max: 59,  grade: 'D7', remark: 'Pass' },
      { min: 50, max: 54,  grade: 'E8', remark: 'Pass' },
      { min: 0,  max: 49,  grade: 'F9', remark: 'Fail'  },
    ]);
    await db.execute(
      `INSERT INTO school_settings
       (id, school_name, school_short_name, school_motto,
        school_address, school_phone, school_email,
        result_footer, result_grading_system)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'Ogotech Conventional/Technical School',
        'Ogotech',
        'Excellence Through Knowledge and Skills',
        'Delta State, Nigeria',
        '+234-800-000-0000',
        'info@ogotech.edu.ng',
        'This result is computer-generated and valid without signature.',
        defaultGrading,
      ]
    );
  }
}

// GET /api/settings - public (needed for result slip)
router.get('/', async (req, res) => {
  try {
    await ensureSettingsTable();
    const db = getDB();
    const [rows] = await db.execute('SELECT * FROM school_settings WHERE id = 1');
    const settings = rows[0];
    if (settings?.result_grading_system && typeof settings.result_grading_system === 'string') {
      try { settings.result_grading_system = JSON.parse(settings.result_grading_system); } catch {}
    }
    res.json({ settings: settings || {} });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load settings' });
  }
});

// PUT /api/settings - admin only
router.put('/', authenticate, authorize('superadmin', 'admin'), async (req, res) => {
  try {
    await ensureSettingsTable();
    const db = getDB();
    const {
      school_name, school_short_name, school_motto, school_address,
      school_phone, school_email, school_website, school_logo_url,
      result_footer, result_color, result_show_position,
      result_show_class, result_show_teacher_comment,
      result_grading_system, principal_name, principal_title,
      exam_officer_name, stamp_text,
    } = req.body;

    await db.execute(`
      UPDATE school_settings SET
        school_name = ?, school_short_name = ?, school_motto = ?,
        school_address = ?, school_phone = ?, school_email = ?,
        school_website = ?, school_logo_url = ?,
        result_footer = ?, result_color = ?,
        result_show_position = ?, result_show_class = ?,
        result_show_teacher_comment = ?,
        result_grading_system = ?, principal_name = ?,
        principal_title = ?, exam_officer_name = ?, stamp_text = ?
      WHERE id = 1
    `, [
      school_name, school_short_name, school_motto, school_address,
      school_phone, school_email, school_website, school_logo_url,
      result_footer, result_color,
      result_show_position ? 1 : 0,
      result_show_class ? 1 : 0,
      result_show_teacher_comment ? 1 : 0,
      JSON.stringify(result_grading_system || []),
      principal_name, principal_title, exam_officer_name, stamp_text,
    ]);

    res.json({ message: 'Settings saved successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to save settings' });
  }
});

module.exports = router;
