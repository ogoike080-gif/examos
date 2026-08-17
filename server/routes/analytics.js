const express = require('express');
const { getDB } = require('../models/db');
const { authenticate, authorize } = require('../middleware/auth');
const { buildCandidateInsights } = require('../utils/insights');

const router = express.Router();

// GET /api/analytics/my-insights — "Mistake Detective": weak/strong topics for the logged-in candidate
router.get('/my-insights', authenticate, authorize('candidate'), async (req, res) => {
  try {
    const insights = await buildCandidateInsights(req.user.id);
    res.json(insights);
  } catch (err) {
    console.error('my-insights error:', err.message);
    res.status(500).json({ error: 'Failed to build insights: ' + err.message });
  }
});

// GET /api/analytics/dashboard - main dashboard stats
router.get('/dashboard', authenticate, authorize('superadmin', 'admin', 'examiner', 'proctor'), async (req, res) => {
  try {
    const db = getDB();

    const [[activeSessions]] = await db.execute(
      "SELECT COUNT(*) as count FROM exam_sessions WHERE status = 'active'"
    );
    const [[flaggedSessions]] = await db.execute(
      `SELECT COUNT(DISTINCT session_id) as count FROM proctor_events
       WHERE severity = 'critical' AND reviewed = FALSE`
    );
    const [[completedToday]] = await db.execute(
      "SELECT COUNT(*) as count FROM exam_sessions WHERE status = 'submitted' AND DATE(submitted_at) = CURDATE()"
    );
    const [[totalQuestions]] = await db.execute(
      'SELECT COUNT(*) as count FROM questions WHERE is_active = TRUE'
    );
    const [[activeExams]] = await db.execute(
      "SELECT COUNT(*) as count FROM exams WHERE status = 'active'"
    );

    // Recent activity
    const [recentSessions] = await db.execute(
      `SELECT es.id, es.status, es.score, es.percentage, es.submitted_at,
       u.full_name as candidate_name, e.title as exam_title
       FROM exam_sessions es
       JOIN users u ON es.candidate_id = u.id
       JOIN exams e ON es.exam_id = e.id
       ORDER BY es.updated_at DESC LIMIT 10`
    );

    // Active exam sessions summary
    const [examSummary] = await db.execute(
      `SELECT e.id, e.title, e.status, e.duration_minutes,
       COUNT(es.id) as candidate_count,
       SUM(CASE WHEN es.status='active' THEN 1 ELSE 0 END) as active_count,
       SUM(CASE WHEN es.status='submitted' THEN 1 ELSE 0 END) as submitted_count
       FROM exams e
       LEFT JOIN exam_sessions es ON e.id = es.exam_id
       WHERE e.status IN ('active','scheduled')
       GROUP BY e.id ORDER BY e.scheduled_at DESC LIMIT 10`
    );

    res.json({
      stats: {
        active_sessions: activeSessions.count,
        flagged_sessions: flaggedSessions.count,
        completed_today: completedToday.count,
        total_questions: totalQuestions.count,
        active_exams: activeExams.count,
      },
      recent_sessions: recentSessions,
      exam_summary: examSummary,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch dashboard data' });
  }
});

// GET /api/analytics/exam/:examId - detailed exam analytics
router.get('/exam/:examId', authenticate, authorize('superadmin', 'admin', 'examiner'), async (req, res) => {
  try {
    const db = getDB();
    const { examId } = req.params;

    // Score distribution
    const [scoreDistribution] = await db.execute(
      `SELECT
       CASE
         WHEN percentage >= 90 THEN '90-100'
         WHEN percentage >= 80 THEN '80-89'
         WHEN percentage >= 70 THEN '70-79'
         WHEN percentage >= 60 THEN '60-69'
         WHEN percentage >= 50 THEN '50-59'
         ELSE 'Below 50'
       END as range,
       COUNT(*) as count
       FROM exam_sessions WHERE exam_id = ? AND status = 'submitted'
       GROUP BY range ORDER BY MIN(percentage) DESC`,
      [examId]
    );

    // Summary stats
    const [[summary]] = await db.execute(
      `SELECT
       COUNT(*) as total_candidates,
       AVG(percentage) as avg_percentage,
       MAX(percentage) as max_percentage,
       MIN(percentage) as min_percentage,
       SUM(CASE WHEN status='submitted' THEN 1 ELSE 0 END) as submitted,
       SUM(CASE WHEN status='disqualified' THEN 1 ELSE 0 END) as disqualified
       FROM exam_sessions WHERE exam_id = ?`,
      [examId]
    );

    // Pass rate
    const [exam] = await db.execute('SELECT pass_marks, total_marks FROM exams WHERE id = ?', [examId]);
    const passThreshold = exam[0] ? (exam[0].pass_marks / exam[0].total_marks) * 100 : 50;

    const [[passRate]] = await db.execute(
      'SELECT COUNT(*) as count FROM exam_sessions WHERE exam_id = ? AND percentage >= ? AND status = ?',
      [examId, passThreshold, 'submitted']
    );

    // Violations summary
    const [[violations]] = await db.execute(
      `SELECT COUNT(DISTINCT pe.session_id) as flagged_sessions,
       COUNT(*) as total_events
       FROM proctor_events pe
       JOIN exam_sessions es ON pe.session_id = es.id
       WHERE es.exam_id = ? AND pe.severity IN ('warning','critical')`,
      [examId]
    );

    res.json({
      score_distribution: scoreDistribution,
      summary: { ...summary, pass_rate: ((passRate.count / (summary.submitted || 1)) * 100).toFixed(1) },
      violations,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch exam analytics' });
  }
});

// GET /api/analytics/question/:questionId - question item analysis
router.get('/question/:questionId', authenticate, authorize('superadmin', 'admin', 'examiner'), async (req, res) => {
  try {
    const db = getDB();

    // Calculate P-value from real data
    const [answerData] = await db.execute(
      `SELECT es.answers, eq.question_id, q.correct_answers
       FROM exam_sessions es
       JOIN exam_questions eq ON es.exam_id = eq.exam_id
       JOIN questions q ON eq.question_id = q.id
       WHERE q.id = ? AND es.status = 'submitted'`,
      [req.params.questionId]
    );

    let correct = 0;
    let total = answerData.length;

    for (const row of answerData) {
      const answers = JSON.parse(row.answers || '{}');
      const correctAnswers = JSON.parse(row.correct_answers || '[]');
      const candidateAnswer = answers[req.params.questionId]?.answer;
      if (candidateAnswer && correctAnswers.includes(candidateAnswer)) correct++;
    }

    const pValue = total > 0 ? correct / total : null;
    if (pValue !== null) {
      await db.execute('UPDATE questions SET p_value = ?, times_used = ? WHERE id = ?',
        [pValue, total, req.params.questionId]);
    }

    res.json({ p_value: pValue, total_attempts: total, correct_count: correct });
  } catch (err) {
    res.status(500).json({ error: 'Failed to analyze question' });
  }
});



// GET /api/analytics/health - real server health (no demo data)
router.get('/health', authenticate, async (req, res) => {
  try {
    const db = getDB();
    const [[sessionCount]] = await db.execute("SELECT COUNT(*) as cnt FROM exam_sessions WHERE status = 'active'");
    const [[questionCount]] = await db.execute('SELECT COUNT(*) as cnt FROM questions WHERE is_active = TRUE');
    const [[userCount]] = await db.execute('SELECT COUNT(*) as cnt FROM users WHERE is_active = TRUE');
    const [[examCount]] = await db.execute("SELECT COUNT(*) as cnt FROM exams WHERE status = 'active'");

    res.json({
      status: 'ok',
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      active_sessions: sessionCount.cnt,
      active_exams: examCount.cnt,
      total_questions: questionCount.cnt,
      total_users: userCount.cnt,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ error: 'Health check failed' });
  }
});

module.exports = router;
