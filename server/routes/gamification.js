const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('../models/db');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// ── XP award amounts ─────────────────────────────────────────
const XP_REWARDS = {
  exam_submitted:   20,
  exam_passed:      50,
  score_90_plus:   100,
  score_100:       200,
  daily_login:      10,
  streak_7:         75,
  streak_14:       150,
  streak_30:       300,
};

const BADGES = [
  { id:'first_exam',    check: (s) => s.total_exams >= 1,                              xp:50  },
  { id:'perfect_score', check: (s) => s.latest_score >= 100,                           xp:200 },
  { id:'five_exams',    check: (s) => s.total_exams >= 5,                              xp:100 },
  { id:'ten_exams',     check: (s) => s.total_exams >= 10,                             xp:150 },
  { id:'pass_streak_3', check: (s) => s.pass_streak >= 3,                              xp:120 },
  { id:'pass_streak_5', check: (s) => s.pass_streak >= 5,                              xp:250 },
  { id:'scholar',       check: (s) => s.avg_score >= 80 && s.total_exams >= 3,         xp:175 },
  { id:'early_bird',    check: (s) => s.exam_hour < 8,                                 xp:75  },
  { id:'speed_demon',   check: (s) => s.time_left_pct >= 50,                           xp:100 },
  { id:'improver',      check: (s) => s.improved,                                      xp:80  },
];

// ── Ensure gamification tables exist ─────────────────────────
async function ensureGamTables(db) {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS user_xp (
      id VARCHAR(36) PRIMARY KEY,
      user_id VARCHAR(36) NOT NULL UNIQUE,
      xp INT DEFAULT 0,
      streak INT DEFAULT 0,
      last_active DATE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS user_badges (
      id VARCHAR(36) PRIMARY KEY,
      user_id VARCHAR(36) NOT NULL,
      badge_id VARCHAR(50) NOT NULL,
      earned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY unique_badge (user_id, badge_id)
    )
  `);
}

// ── Award XP to a user ───────────────────────────────────────
async function awardXP(db, userId, amount) {
  await db.execute(`
    INSERT INTO user_xp (id, user_id, xp)
    VALUES (?, ?, ?)
    ON DUPLICATE KEY UPDATE xp = xp + ?
  `, [uuidv4(), userId, amount, amount]);
}

// ── Update streak ────────────────────────────────────────────
async function updateStreak(db, userId) {
  const today = new Date().toISOString().slice(0,10);
  const [rows] = await db.execute('SELECT streak, last_active FROM user_xp WHERE user_id=?', [userId]);
  if (!rows[0]) return 1;

  const last = rows[0].last_active;
  const lastStr = last ? new Date(last).toISOString().slice(0,10) : null;

  if (lastStr === today) return rows[0].streak; // already counted today

  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0,10);
  const newStreak = lastStr === yesterday ? rows[0].streak + 1 : 1;

  await db.execute('UPDATE user_xp SET streak=?, last_active=? WHERE user_id=?', [newStreak, today, userId]);
  return newStreak;
}

// ── Check and award badges ───────────────────────────────────
async function checkBadges(db, userId, stats) {
  const [earned] = await db.execute('SELECT badge_id FROM user_badges WHERE user_id=?', [userId]);
  const earnedSet = new Set(earned.map(b => b.badge_id));
  const newBadges = [];

  for (const badge of BADGES) {
    if (!earnedSet.has(badge.id) && badge.check(stats)) {
      await db.execute(
        'INSERT IGNORE INTO user_badges (id, user_id, badge_id) VALUES (?,?,?)',
        [uuidv4(), userId, badge.id]
      );
      await awardXP(db, userId, badge.xp);
      newBadges.push({ badge_id: badge.id, xp: badge.xp });
    }
  }
  return newBadges;
}

// ── POST /api/gamification/on-submit ─────────────────────────
// Called after a candidate submits an exam
router.post('/on-submit', authenticate, async (req, res) => {
  try {
    const db = getDB();
    await ensureGamTables(db);

    const { session_id } = req.body;
    const userId = req.user.id;

    // Load session data
    const [sessions] = await db.execute(`
      SELECT es.*, e.duration_minutes, e.pass_marks, e.total_marks
      FROM exam_sessions es JOIN exams e ON es.exam_id = e.id
      WHERE es.id = ? AND es.candidate_id = ?
    `, [session_id, userId]);

    if (!sessions[0]) return res.status(404).json({ error: 'Session not found' });
    const session = sessions[0];
    const pct = parseFloat(session.percentage || 0);
    const passed = pct >= (session.pass_marks / session.total_marks) * 100;

    // Ensure XP row exists
    await db.execute(
      'INSERT IGNORE INTO user_xp (id, user_id, xp) VALUES (?,?,0)',
      [uuidv4(), userId]
    );

    let totalXPAwarded = 0;
    const xpBreakdown = [];

    // Base XP for submitting
    await awardXP(db, userId, XP_REWARDS.exam_submitted);
    totalXPAwarded += XP_REWARDS.exam_submitted;
    xpBreakdown.push({ reason:'Exam submitted', xp: XP_REWARDS.exam_submitted });

    // Passed bonus
    if (passed) {
      await awardXP(db, userId, XP_REWARDS.exam_passed);
      totalXPAwarded += XP_REWARDS.exam_passed;
      xpBreakdown.push({ reason:'Exam passed', xp: XP_REWARDS.exam_passed });
    }

    // Score bonuses
    if (pct >= 100) {
      await awardXP(db, userId, XP_REWARDS.score_100);
      totalXPAwarded += XP_REWARDS.score_100;
      xpBreakdown.push({ reason:'Perfect score!', xp: XP_REWARDS.score_100 });
    } else if (pct >= 90) {
      await awardXP(db, userId, XP_REWARDS.score_90_plus);
      totalXPAwarded += XP_REWARDS.score_90_plus;
      xpBreakdown.push({ reason:'90%+ score', xp: XP_REWARDS.score_90_plus });
    }

    // Update streak
    const streak = await updateStreak(db, userId);
    if (streak === 7)  { await awardXP(db, userId, XP_REWARDS.streak_7);  totalXPAwarded += XP_REWARDS.streak_7;  xpBreakdown.push({ reason:'7-day streak!', xp: XP_REWARDS.streak_7 }); }
    if (streak === 14) { await awardXP(db, userId, XP_REWARDS.streak_14); totalXPAwarded += XP_REWARDS.streak_14; xpBreakdown.push({ reason:'14-day streak!', xp: XP_REWARDS.streak_14 }); }
    if (streak === 30) { await awardXP(db, userId, XP_REWARDS.streak_30); totalXPAwarded += XP_REWARDS.streak_30; xpBreakdown.push({ reason:'30-day streak!', xp: XP_REWARDS.streak_30 }); }

    // Get stats for badge checking
    const [[totals]] = await db.execute(`
      SELECT COUNT(*) as total_exams,
             AVG(percentage) as avg_score,
             SUM(CASE WHEN percentage >= 50 THEN 1 ELSE 0 END) as total_passed
      FROM exam_sessions WHERE candidate_id=? AND status='submitted'
    `, [userId]);

    // Calculate pass streak
    const [lastFive] = await db.execute(`
      SELECT percentage, pass_marks, total_marks FROM exam_sessions es
      JOIN exams e ON es.exam_id = e.id
      WHERE es.candidate_id=? AND es.status='submitted'
      ORDER BY es.submitted_at DESC LIMIT 10
    `, [userId]);
    let passStreak = 0;
    for (const s of lastFive) {
      const p = parseFloat(s.percentage||0);
      const pm = (s.pass_marks / s.total_marks) * 100;
      if (p >= pm) passStreak++; else break;
    }

    // Previous best score for same exam type (improved check)
    const [prevBest] = await db.execute(`
      SELECT MAX(percentage) as best FROM exam_sessions
      WHERE candidate_id=? AND exam_id=? AND id!=? AND status='submitted'
    `, [userId, session.exam_id, session_id]);
    const improved = prevBest[0]?.best !== null && pct > parseFloat(prevBest[0]?.best || 0);

    // Time left %
    const timeTaken = session.started_at && session.submitted_at
      ? (new Date(session.submitted_at) - new Date(session.started_at)) / 1000
      : session.duration_minutes * 60;
    const timeLeftPct = ((session.duration_minutes * 60 - timeTaken) / (session.duration_minutes * 60)) * 100;

    const stats = {
      total_exams: totals.total_exams,
      avg_score: parseFloat(totals.avg_score || 0),
      latest_score: pct,
      pass_streak: passStreak,
      improved,
      exam_hour: new Date(session.submitted_at || Date.now()).getHours(),
      time_left_pct: timeLeftPct,
    };

    const newBadges = await checkBadges(db, userId, stats);

    // Get updated XP
    const [[xpRow]] = await db.execute('SELECT xp, streak FROM user_xp WHERE user_id=?', [userId]);

    res.json({
      xp_awarded: totalXPAwarded,
      xp_breakdown: xpBreakdown,
      new_badges: newBadges,
      total_xp: xpRow?.xp || 0,
      streak: xpRow?.streak || 0,
    });
  } catch (err) {
    console.error('gamification error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/gamification/profile ────────────────────────────
router.get('/profile', authenticate, async (req, res) => {
  try {
    const db = getDB();
    await ensureGamTables(db);
    const userId = req.user.id;

    // Ensure row exists
    await db.execute('INSERT IGNORE INTO user_xp (id,user_id,xp) VALUES (?,?,0)', [uuidv4(), userId]);

    const [[xpRow]] = await db.execute('SELECT * FROM user_xp WHERE user_id=?', [userId]);
    const [badges] = await db.execute('SELECT * FROM user_badges WHERE user_id=? ORDER BY earned_at DESC', [userId]);

    const [[stats]] = await db.execute(`
      SELECT COUNT(*) as exams_taken,
             COALESCE(AVG(percentage),0) as avg_score
      FROM exam_sessions WHERE candidate_id=? AND status='submitted'
    `, [userId]);

    const [recentExams] = await db.execute(`
      SELECT es.score, es.percentage, es.submitted_at, e.title, e.total_marks as exam_total
      FROM exam_sessions es JOIN exams e ON es.exam_id=e.id
      WHERE es.candidate_id=? AND es.status='submitted'
      ORDER BY es.submitted_at DESC LIMIT 5
    `, [userId]);

    // Leaderboard top 10
    const [leaderboard] = await db.execute(`
      SELECT u.id, u.full_name, u.class_name, ux.xp,
             (SELECT COUNT(*) FROM exam_sessions es WHERE es.candidate_id=u.id AND es.status='submitted') as exams_taken
      FROM users u
      LEFT JOIN user_xp ux ON ux.user_id=u.id
      WHERE u.role='candidate' AND u.is_active=TRUE
      ORDER BY COALESCE(ux.xp,0) DESC LIMIT 10
    `);

    res.json({
      id: userId,
      full_name: req.user.full_name,
      class_name: req.user.class_name,
      xp: xpRow?.xp || 0,
      streak: xpRow?.streak || 0,
      last_active: xpRow?.last_active,
      badges,
      exams_taken: stats.exams_taken,
      avg_score: parseFloat(stats.avg_score || 0),
      recent_exams: recentExams,
      leaderboard,
    });
  } catch (err) {
    console.error('profile error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/gamification/leaderboard ────────────────────────
router.get('/leaderboard', authenticate, async (req, res) => {
  try {
    const db = getDB();
    await ensureGamTables(db);
    const { class_name } = req.query;

    let where = "u.role='candidate' AND u.is_active=TRUE";
    const params = [];
    if (class_name) { where += ' AND u.class_name=?'; params.push(class_name); }

    const [rows] = await db.execute(`
      SELECT u.id, u.full_name, u.class_name, COALESCE(ux.xp,0) as xp,
             (SELECT COUNT(*) FROM exam_sessions es WHERE es.candidate_id=u.id AND es.status='submitted') as exams_taken,
             COALESCE(ux.streak,0) as streak
      FROM users u LEFT JOIN user_xp ux ON ux.user_id=u.id
      WHERE ${where}
      ORDER BY xp DESC LIMIT 50
    `, params);

    res.json({ leaderboard: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
