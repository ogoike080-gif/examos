const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('../models/db');
const { authenticate, optionalAuthenticate, authorize } = require('../middleware/auth');

const router = express.Router();

// GET /api/subjects — deliberately optionalAuthenticate, not authenticate.
// The practice/study setup screens (StudyApp.jsx, PracticeMode.jsx) need
// this list to populate the Subject field BEFORE a visitor logs in at all
// (the anonymous "Practice Free" entry point) — this used to force a login
// just to see subject names, which is why custom subjects an admin adds
// here (e.g. "GS COURSE 101", "MATHS101" for a university's own courses)
// never showed up as selectable on those setup screens: the request that
// would have fetched them 401'd before the page ever got the real list, and
// silently fell back to a separate hardcoded subject list baked into the
// client instead. Nothing here is sensitive — it's just subject names.
router.get('/', optionalAuthenticate, async (req, res) => {
  try {
    const db = getDB();
    const [subjects] = await db.execute(
      `SELECT s.*,
       (SELECT COUNT(*) FROM questions q WHERE q.subject_id = s.id AND q.is_active = TRUE) as question_count,
       (SELECT COUNT(*) FROM exams e WHERE e.subject_id = s.id) as exam_count
       FROM subjects s ORDER BY s.name`
    );
    res.json({ subjects });
  } catch (err) {
    console.error('GET /subjects error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/subjects
router.post('/', authenticate, authorize('superadmin', 'admin'), async (req, res) => {
  try {
    const db = getDB();
    const { name, code, description } = req.body;

    if (!name || !code) {
      return res.status(400).json({ error: 'Name and code are required' });
    }

    const cleanCode = code.toUpperCase().trim();

    const [existing] = await db.execute(
      'SELECT id FROM subjects WHERE code = ?',
      [cleanCode]
    );
    if (existing.length > 0) {
      return res.status(409).json({ error: `Subject code "${cleanCode}" already exists` });
    }

    const id = uuidv4();
    await db.execute(
      'INSERT INTO subjects (id, name, code, description) VALUES (?, ?, ?, ?)',
      [id, name.trim(), cleanCode, description || null]
    );

    const [newSubject] = await db.execute(
      'SELECT * FROM subjects WHERE id = ?',
      [id]
    );
    res.status(201).json({ subject: newSubject[0] });
  } catch (err) {
    console.error('POST /subjects error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/subjects/:id
router.put('/:id', authenticate, authorize('superadmin', 'admin'), async (req, res) => {
  try {
    const db = getDB();
    const { name, code, description } = req.body;

    if (!name || !code) {
      return res.status(400).json({ error: 'Name and code are required' });
    }

    const cleanCode = code.toUpperCase().trim();

    const [existing] = await db.execute(
      'SELECT id FROM subjects WHERE code = ? AND id != ?',
      [cleanCode, req.params.id]
    );
    if (existing.length > 0) {
      return res.status(409).json({ error: `Code "${cleanCode}" is used by another subject` });
    }

    await db.execute(
      'UPDATE subjects SET name = ?, code = ?, description = ? WHERE id = ?',
      [name.trim(), cleanCode, description || null, req.params.id]
    );

    res.json({ message: 'Subject updated successfully' });
  } catch (err) {
    console.error('PUT /subjects error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/subjects/:id
router.delete('/:id', authenticate, authorize('superadmin', 'admin'), async (req, res) => {
  try {
    const db = getDB();

    const [[qCount]] = await db.execute(
      'SELECT COUNT(*) as cnt FROM questions WHERE subject_id = ? AND is_active = TRUE',
      [req.params.id]
    );

    if (qCount.cnt > 0) {
      return res.status(409).json({
        error: `Cannot delete — ${qCount.cnt} active question(s) are linked to this subject. Reassign them first.`
      });
    }

    await db.execute('DELETE FROM subjects WHERE id = ?', [req.params.id]);
    res.json({ message: 'Subject deleted' });
  } catch (err) {
    console.error('DELETE /subjects error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;