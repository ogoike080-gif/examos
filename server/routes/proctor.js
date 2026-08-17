const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('../models/db');
const { authenticate, authorize } = require('../middleware/auth');
const { analyzeProctoringEvent, analyzeSessionBehavior } = require('../ai/questionGenerator');

const router = express.Router();

// POST /api/proctor/event - log a proctoring event
router.post('/event', authenticate, async (req, res) => {
  try {
    const db = getDB();
    const {
      session_id, event_type, description,
      metadata, screenshot_url
    } = req.body;

    // Get session info
    const [sessions] = await db.execute(
      `SELECT es.*, u.full_name as candidate_name,
       TIMESTAMPDIFF(MINUTE, es.started_at, NOW()) as elapsed_minutes
       FROM exam_sessions es
       JOIN users u ON es.candidate_id = u.id
       WHERE es.id = ?`,
      [session_id]
    );

    if (!sessions[0]) return res.status(404).json({ error: 'Session not found' });
    const session = sessions[0];

    // Count previous violations
    const [prevViolations] = await db.execute(
      "SELECT COUNT(*) as cnt FROM proctor_events WHERE session_id = ? AND severity != 'info'",
      [session_id]
    );

    // AI analysis
    const aiAnalysis = await analyzeProctoringEvent({
      event_type,
      candidate_name: session.candidate_name,
      face_confidence: metadata?.face_confidence,
      gaze_data: metadata?.gaze_data,
      audio_level: metadata?.audio_level,
      tab_switches: metadata?.tab_switches,
      face_count: metadata?.face_count,
      elapsed_minutes: session.elapsed_minutes,
      previous_violations: prevViolations[0].cnt,
    });

    const id = uuidv4();
    await db.execute(
      `INSERT INTO proctor_events
       (id, session_id, candidate_id, event_type, severity, description,
        ai_confidence, screenshot_url, metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, session_id, session.candidate_id, event_type,
       aiAnalysis.severity,
       aiAnalysis.reason || description,
       aiAnalysis.confidence,
       screenshot_url,
       JSON.stringify({ ...metadata, ai_analysis: aiAnalysis })]
    );

    // If critical, update session status
    if (aiAnalysis.recommended_action === 'terminate') {
      await db.execute(
        "UPDATE exam_sessions SET status = 'terminated' WHERE id = ?",
        [session_id]
      );
    }

    res.json({ event_id: id, ai_analysis: aiAnalysis });
  } catch (err) {
    console.error('Proctor event error:', err);
    res.status(500).json({ error: 'Failed to log event' });
  }
});

// GET /api/proctor/session/:sessionId/events
router.get('/session/:sessionId/events', authenticate, authorize('superadmin', 'admin', 'proctor'), async (req, res) => {
  try {
    const db = getDB();
    const [events] = await db.execute(
      `SELECT pe.*, u.full_name as candidate_name
       FROM proctor_events pe
       JOIN users u ON pe.candidate_id = u.id
       WHERE pe.session_id = ? ORDER BY pe.created_at DESC`,
      [req.params.sessionId]
    );
    res.json({ events });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch events' });
  }
});

// GET /api/proctor/live - live monitoring data
router.get('/live', authenticate, authorize('superadmin', 'admin', 'proctor'), async (req, res) => {
  try {
    const db = getDB();
    const { exam_id } = req.query;

    let where = "es.status IN ('active','paused')";
    const params = [];
    if (exam_id) { where += ' AND es.exam_id = ?'; params.push(exam_id); }

    const [sessions] = await db.execute(
      `SELECT es.id, es.status, es.started_at, es.auto_save_at,
       u.full_name as candidate_name, u.id as candidate_id,
       e.title as exam_title, e.duration_minutes,
       TIMESTAMPDIFF(MINUTE, es.started_at, NOW()) as elapsed_minutes,
       (SELECT COUNT(*) FROM proctor_events pe WHERE pe.session_id = es.id AND pe.severity = 'critical') as critical_count,
       (SELECT COUNT(*) FROM proctor_events pe WHERE pe.session_id = es.id AND pe.severity = 'warning') as warning_count,
       (SELECT COUNT(*) FROM proctor_events pe WHERE pe.session_id = es.id) as total_events,
       JSON_LENGTH(es.answers) as answers_count,
       JSON_LENGTH(es.question_order) as total_questions
       FROM exam_sessions es
       JOIN users u ON es.candidate_id = u.id
       JOIN exams e ON es.exam_id = e.id
       WHERE ${where}
       ORDER BY critical_count DESC, warning_count DESC`,
      params
    );

    // Summary stats
    const [allSessions] = await db.execute(
      `SELECT status, COUNT(*) as count FROM exam_sessions
       WHERE exam_id = ? OR ? IS NULL GROUP BY status`,
      [exam_id || null, exam_id || null]
    );

    res.json({ sessions, summary: allSessions });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch live data' });
  }
});

// POST /api/proctor/action - proctor action on session
router.post('/action', authenticate, authorize('superadmin', 'admin', 'proctor'), async (req, res) => {
  try {
    const db = getDB();
    const { session_id, action, reason } = req.body;

    const validActions = { warn: 'active', pause: 'paused', resume: 'active', terminate: 'terminated', disqualify: 'disqualified' };
    if (!validActions[action]) return res.status(400).json({ error: 'Invalid action' });

    await db.execute(
      'UPDATE exam_sessions SET status = ? WHERE id = ?',
      [validActions[action], session_id]
    );

    // Log action as proctor event
    await db.execute(
      `INSERT INTO proctor_events (id, session_id, candidate_id, event_type, severity, description, metadata)
       SELECT ?, ?, candidate_id, ?, 'info', ?, ?
       FROM exam_sessions WHERE id = ?`,
      [uuidv4(), session_id, `proctor_${action}`, reason || `Proctor action: ${action}`,
       JSON.stringify({ proctor_id: req.user.id, action }), session_id]
    );

    res.json({ success: true, new_status: validActions[action] });
  } catch (err) {
    res.status(500).json({ error: 'Action failed' });
  }
});

// POST /api/proctor/analyze-session - full AI session analysis
router.post('/analyze-session/:sessionId', authenticate, authorize('superadmin', 'admin', 'proctor'), async (req, res) => {
  try {
    const db = getDB();
    const [events] = await db.execute(
      'SELECT * FROM proctor_events WHERE session_id = ? ORDER BY created_at',
      [req.params.sessionId]
    );
    const [sessions] = await db.execute(
      `SELECT es.*, JSON_LENGTH(es.answers) as answers_count, JSON_LENGTH(es.question_order) as total_questions,
       TIMESTAMPDIFF(MINUTE, es.started_at, IFNULL(es.submitted_at, NOW())) as duration_minutes
       FROM exam_sessions es WHERE es.id = ?`,
      [req.params.sessionId]
    );

    if (!sessions[0]) return res.status(404).json({ error: 'Session not found' });

    const analysis = await analyzeSessionBehavior({
      events,
      duration_minutes: sessions[0].duration_minutes,
      answers_count: sessions[0].answers_count,
      total_questions: sessions[0].total_questions,
    });

    res.json({ analysis });
  } catch (err) {
    res.status(500).json({ error: 'Analysis failed' });
  }
});

module.exports = router;
