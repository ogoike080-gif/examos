const express = require('express');
const { getDB } = require('../models/db');
const { authenticate, authorize } = require('../middleware/auth');
const { buildCandidateInsights } = require('../utils/insights');

const router = express.Router();

// GET /api/parent/children — list the students linked to this parent account
router.get('/children', authenticate, authorize('parent'), async (req, res) => {
  try {
    const db = getDB();
    const [children] = await db.execute(
      `SELECT u.id, u.full_name, u.email, u.class_name, u.reg_number
       FROM parent_links pl JOIN users u ON pl.candidate_id = u.id
       WHERE pl.parent_id = ? AND u.is_active = TRUE`,
      [req.user.id]
    );
    res.json({ children });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/parent/children/:candidateId/report — full performance report for one linked child
router.get('/children/:candidateId/report', authenticate, authorize('parent'), async (req, res) => {
  try {
    const db = getDB();
    // Confirm this parent is actually linked to this candidate before showing anything
    const [link] = await db.execute(
      "SELECT id FROM parent_links WHERE parent_id=? AND candidate_id=?",
      [req.user.id, req.params.candidateId]
    );
    if (!link[0]) return res.status(403).json({ error: 'Not linked to this student' });

    const [studentRows] = await db.execute(
      "SELECT id, full_name, email, class_name FROM users WHERE id=?", [req.params.candidateId]
    );
    if (!studentRows[0]) return res.status(404).json({ error: 'Student not found' });

    const insights = await buildCandidateInsights(req.params.candidateId);
    res.json({ student: studentRows[0], insights });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
