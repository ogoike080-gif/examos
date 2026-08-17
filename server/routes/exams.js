const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('../models/db');
const { authenticate, authorize } = require('../middleware/auth');
const { gradeEssayWithAI } = require('../ai/questionGenerator');

const router = express.Router();

function safeParseArray(val) {
  if (Array.isArray(val)) return val;
  if (!val) return [];
  try { const p = JSON.parse(val); return Array.isArray(p) ? p : []; }
  catch { return []; }
}
function safeParseObject(val) {
  if (val && typeof val === 'object' && !Array.isArray(val)) return val;
  if (!val) return {};
  try { return JSON.parse(val); } catch { return {}; }
}
function normalise(str) {
  if (str === null || str === undefined) return '';
  return String(str).trim().toLowerCase().replace(/\s+/g, ' ');
}
function extractAnswer(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'object' && !Array.isArray(raw) && raw.answer !== undefined)
    return String(raw.answer);
  return String(raw);
}
async function autoActivateIfDue(db, exam) {
  if (exam.status === 'active') return exam;
  if (exam.status === 'scheduled' && exam.scheduled_at) {
    if (new Date() >= new Date(exam.scheduled_at)) {
      await db.execute("UPDATE exams SET status='active', started_at=NOW() WHERE id=?", [exam.id]);
      exam.status = 'active';
      console.log('Exam auto-activated:', exam.title);
    }
  }
  return exam;
}
function getTimeRemaining(session, durationMinutes) {
  if (!session.started_at) return durationMinutes * 60;
  const elapsed = Math.floor((Date.now() - new Date(session.started_at).getTime()) / 1000);
  return Math.max(0, (durationMinutes * 60) - elapsed);
}

async function autoSubmitSession(db, session) {
  try {
    const answers = safeParseObject(session.answers);
    const [questions] = await db.execute(
      `SELECT q.id, q.question_text, q.correct_answers, q.options,
       CASE WHEN eq.marks_override IS NOT NULL THEN eq.marks_override ELSE q.marks END as final_marks
       FROM exam_questions eq JOIN questions q ON eq.question_id=q.id WHERE eq.exam_id=?`,
      [session.exam_id]
    );
    let totalScore = 0, totalMarks = 0;
    const log = [];
    for (const q of questions) {
      const marks = parseFloat(q.final_marks) || 1;
      totalMarks += marks;
      const correctAnswers = safeParseArray(q.correct_answers);
      const options = safeParseArray(q.options);
      const candidateAnswer = extractAnswer(answers[q.id]);
      let isCorrect = false;
      if (candidateAnswer !== null && candidateAnswer.trim() !== '') {
        const nc = normalise(candidateAnswer);
        isCorrect = correctAnswers.some(ca => normalise(ca) === nc);
        if (!isCorrect) {
          const li = ['a','b','c','d','e'].indexOf(nc);
          if (li !== -1 && options[li] !== undefined)
            isCorrect = correctAnswers.some(ca => normalise(ca) === normalise(options[li]));
        }
        if (!isCorrect && !isNaN(Number(nc))) {
          const ni = Number(nc);
          if (options[ni] !== undefined)
            isCorrect = correctAnswers.some(ca => normalise(ca) === normalise(options[ni]));
        }
      }
      if (isCorrect) totalScore += marks;
      log.push({ q: q.question_text?.substring(0,60), candidate: candidateAnswer, correct: correctAnswers, ok: isCorrect });
    }
    const percentage = totalMarks > 0 ? (totalScore / totalMarks) * 100 : 0;
    console.log('\n===== GRADING REPORT =====');
    console.log('Session:', session.id, '| Questions:', questions.length, '| Answered:', Object.keys(answers).length);
    log.forEach((g,i) => {
      console.log((g.ok?'CORRECT':'WRONG  '), 'Q'+(i+1)+':', g.q);
      console.log('  Candidate:', JSON.stringify(g.candidate), '| Correct:', JSON.stringify(g.correct));
    });
    console.log('SCORE:', totalScore+'/'+totalMarks, '=', percentage.toFixed(1)+'%\n===========================\n');
    await db.execute(
      "UPDATE exam_sessions SET status='submitted', score=?, percentage=?, submitted_at=NOW() WHERE id=?",
      [totalScore, percentage, session.id]
    );
    return { submitted: true, score: totalScore, total_marks: totalMarks, percentage: parseFloat(percentage.toFixed(2)) };
  } catch (err) { console.error('Grade error:', err.message); throw err; }
}

// ══════════════════════════════════════════════════════════════
// /sessions/* routes MUST be BEFORE /:id routes
// ══════════════════════════════════════════════════════════════

// POST /api/exams/sessions/:sessionId/answer
router.post('/sessions/:sessionId/answer', authenticate, async (req, res) => {
  try {
    const db = getDB();
    const { question_id, answer } = req.body;

    const [sessions] = await db.execute(
      `SELECT es.*, e.duration_minutes FROM exam_sessions es
       JOIN exams e ON es.exam_id=e.id WHERE es.id=? AND es.candidate_id=?`,
      [req.params.sessionId, req.user.id]
    );
    if (!sessions[0]) return res.status(404).json({ error: 'Session not found' });
    const session = sessions[0];

    if (session.status === 'submitted') return res.json({ saved: false, auto_submitted: true });

    // ── KEY FIX: if session is 'waiting', activate it now ──
    if (session.status === 'waiting') {
      await db.execute(
        "UPDATE exam_sessions SET status='active', started_at=NOW() WHERE id=?",
        [session.id]
      );
      session.status = 'active';
      session.started_at = new Date();
    }

    if (!['active','paused'].includes(session.status)) {
      return res.status(400).json({ error: 'Session cannot accept answers (status: ' + session.status + ')' });
    }

    const remaining = getTimeRemaining(session, session.duration_minutes);
    const answers = safeParseObject(session.answers);
    answers[question_id] = { answer: String(answer), saved_at: new Date().toISOString() };
    await db.execute('UPDATE exam_sessions SET answers=?, auto_save_at=NOW() WHERE id=?',
      [JSON.stringify(answers), session.id]);

    if (remaining === 0) {
      session.answers = JSON.stringify(answers);
      await autoSubmitSession(db, session);
      return res.json({ saved: true, auto_submitted: true });
    }
    res.json({ saved: true, question_id, time_remaining_seconds: remaining });
  } catch (err) {
    console.error('save answer error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/exams/sessions/:sessionId/submit
router.post('/sessions/:sessionId/submit', authenticate, async (req, res) => {
  try {
    const db = getDB();
    const [sessions] = await db.execute(
      `SELECT es.*, e.duration_minutes FROM exam_sessions es
       JOIN exams e ON es.exam_id=e.id WHERE es.id=? AND es.candidate_id=?`,
      [req.params.sessionId, req.user.id]
    );
    if (!sessions[0]) return res.status(404).json({ error: 'Session not found' });
    if (sessions[0].status === 'submitted') return res.status(409).json({ error: 'Already submitted' });
    const result = await autoSubmitSession(db, sessions[0]);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/exams/sessions/:sessionId/check-time
router.post('/sessions/:sessionId/check-time', authenticate, async (req, res) => {
  try {
    const db = getDB();
    const [sessions] = await db.execute(
      `SELECT es.*, e.duration_minutes FROM exam_sessions es
       JOIN exams e ON es.exam_id=e.id WHERE es.id=? AND es.candidate_id=?`,
      [req.params.sessionId, req.user.id]
    );
    if (!sessions[0]) return res.status(404).json({ error: 'Session not found' });
    const session = sessions[0];
    if (session.status === 'submitted') return res.json({ status: 'submitted', time_remaining_seconds: 0 });
    if (!session.started_at) return res.json({ status: session.status, time_remaining_seconds: session.duration_minutes * 60 });
    const remaining = getTimeRemaining(session, session.duration_minutes);
    if (remaining === 0 && session.status === 'active') {
      const result = await autoSubmitSession(db, session);
      return res.json({ status: 'submitted', auto_submitted: true, time_remaining_seconds: 0, ...result });
    }
    res.json({ status: session.status, time_remaining_seconds: remaining });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/exams/sessions/:sessionId/results
router.get('/sessions/:sessionId/results', authenticate, async (req, res) => {
  try {
    const db = getDB();
    const [sessions] = await db.execute(
      `SELECT es.*, e.title, e.pass_marks, e.total_marks as exam_total,
       s.name as subject_name, u.full_name as candidate_name
       FROM exam_sessions es JOIN exams e ON es.exam_id=e.id
       LEFT JOIN subjects s ON e.subject_id=s.id LEFT JOIN users u ON es.candidate_id=u.id
       WHERE es.id=?`,
      [req.params.sessionId]
    );
    if (!sessions[0]) return res.status(404).json({ error: 'Session not found' });
    const isOwner = sessions[0].candidate_id === req.user.id;
    const isAdmin = ['superadmin','admin','proctor','examiner'].includes(req.user.role);
    if (!isOwner && !isAdmin) return res.status(403).json({ error: 'Access denied' });
    res.json({ result: sessions[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/exams/sessions/:sessionId/debug-grade (admin only)
router.get('/sessions/:sessionId/debug-grade', authenticate, authorize('superadmin','admin'), async (req, res) => {
  try {
    const db = getDB();
    const [sessions] = await db.execute(
      `SELECT es.*, e.duration_minutes FROM exam_sessions es JOIN exams e ON es.exam_id=e.id WHERE es.id=?`,
      [req.params.sessionId]
    );
    if (!sessions[0]) return res.status(404).json({ error: 'Session not found' });
    const session = sessions[0];
    const answers = safeParseObject(session.answers);
    const [questions] = await db.execute(
      `SELECT q.id, q.question_text, q.correct_answers, q.options,
       CASE WHEN eq.marks_override IS NOT NULL THEN eq.marks_override ELSE q.marks END as final_marks
       FROM exam_questions eq JOIN questions q ON eq.question_id=q.id WHERE eq.exam_id=?`,
      [session.exam_id]
    );
    let totalScore = 0, totalMarks = 0;
    const breakdown = questions.map(q => {
      const marks = parseFloat(q.final_marks) || 1;
      totalMarks += marks;
      const correctAnswers = safeParseArray(q.correct_answers);
      const options = safeParseArray(q.options);
      const candidateAnswer = extractAnswer(answers[q.id]);
      let isCorrect = false;
      if (candidateAnswer) {
        const nc = normalise(candidateAnswer);
        isCorrect = correctAnswers.some(ca => normalise(ca) === nc);
        if (!isCorrect) {
          const li = ['a','b','c','d','e'].indexOf(nc);
          if (li !== -1 && options[li]) isCorrect = correctAnswers.some(ca => normalise(ca) === normalise(options[li]));
        }
      }
      if (isCorrect) totalScore += marks;
      return { question: q.question_text?.substring(0,80), options, candidate_answer: candidateAnswer, correct_answers: correctAnswers, is_correct: isCorrect, marks_available: marks, marks_awarded: isCorrect ? marks : 0 };
    });
    res.json({ session_id: req.params.sessionId, status: session.status, stored_score: session.score, computed_score: totalScore, total_marks: totalMarks, percentage: totalMarks > 0 ? ((totalScore/totalMarks)*100).toFixed(2):'0.00', answers_submitted: Object.keys(answers).length, questions_count: questions.length, breakdown });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/exams/sessions/:sessionId/review — per-question breakdown with explanations,
// for the student to review after submitting (especially the ones they got wrong)
router.get('/sessions/:sessionId/review', authenticate, async (req, res) => {
  try {
    const db = getDB();
    const [sessions] = await db.execute(
      'SELECT es.*, e.title FROM exam_sessions es JOIN exams e ON es.exam_id=e.id WHERE es.id=?',
      [req.params.sessionId]
    );
    if (!sessions[0]) return res.status(404).json({ error: 'Session not found' });
    const session = sessions[0];

    const isOwner = session.candidate_id === req.user.id;
    const isAdmin = ['superadmin', 'admin', 'proctor', 'examiner'].includes(req.user.role);
    if (!isOwner && !isAdmin) return res.status(403).json({ error: 'Access denied' });
    if (session.status !== 'submitted') return res.status(400).json({ error: 'This exam has not been submitted yet' });

    const answers = safeParseObject(session.answers);
    const [questions] = await db.execute(
      `SELECT q.id, q.question_text, q.question_type, q.correct_answers, q.options, q.explanation,
       CASE WHEN eq.marks_override IS NOT NULL THEN eq.marks_override ELSE q.marks END as marks
       FROM exam_questions eq JOIN questions q ON eq.question_id=q.id
       WHERE eq.exam_id=? ORDER BY eq.display_order ASC`,
      [session.exam_id]
    );

    const items = questions.map((q, i) => {
      const options = safeParseArray(q.options);
      const correctAnswers = safeParseArray(q.correct_answers);
      const candidateAnswer = extractAnswer(answers[q.id]);
      let isCorrect = false;
      if (candidateAnswer) {
        const nc = normalise(candidateAnswer);
        isCorrect = correctAnswers.some(ca => normalise(ca) === nc);
        if (!isCorrect) {
          const li = ['a', 'b', 'c', 'd', 'e'].indexOf(nc);
          if (li !== -1 && options[li]) isCorrect = correctAnswers.some(ca => normalise(ca) === normalise(options[li]));
        }
      }
      return {
        number: i + 1,
        question_text: q.question_text,
        question_type: q.question_type,
        options,
        candidate_answer: candidateAnswer,
        correct_answers: correctAnswers,
        is_correct: q.question_type === 'essay' ? null : isCorrect, // essays aren't auto-graded right/wrong
        explanation: q.explanation || null,
        marks: parseFloat(q.marks) || 0,
      };
    });

    res.json({ exam_title: session.title, items });
  } catch (err) {
    console.error('session review error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/exams
router.get('/', authenticate, async (req, res) => {
  try {
    const db = getDB();
    const { status, subject_id, page=1, limit=20 } = req.query;
    const offset = (page-1)*limit;
    let where = '1=1'; const params = [];
    if (status)     { where += ' AND e.status=?';     params.push(status); }
    if (subject_id) { where += ' AND e.subject_id=?'; params.push(subject_id); }
    if (req.user.role === 'candidate') {
      where += ' AND es.candidate_id=?'; params.push(req.user.id);
      const [exams] = await db.execute(
        `SELECT e.*, s.name as subject_name, es.status as session_status,
         es.id as session_id, es.score, es.percentage
         FROM exams e LEFT JOIN subjects s ON e.subject_id=s.id
         INNER JOIN exam_sessions es ON e.id=es.exam_id
         WHERE ${where} ORDER BY e.scheduled_at DESC LIMIT ? OFFSET ?`,
        [...params, Number(limit), Number(offset)]
      );
      for (const exam of exams) await autoActivateIfDue(db, exam);
      return res.json({ exams });
    }
    const [exams] = await db.execute(
      `SELECT e.*, s.name as subject_name, u.full_name as created_by_name,
       (SELECT COUNT(*) FROM exam_sessions es WHERE es.exam_id=e.id) as candidate_count
       FROM exams e LEFT JOIN subjects s ON e.subject_id=s.id LEFT JOIN users u ON e.created_by=u.id
       WHERE ${where} ORDER BY e.created_at DESC LIMIT ? OFFSET ?`,
      [...params, Number(limit), Number(offset)]
    );
    res.json({ exams });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/exams
router.post('/', authenticate, authorize('superadmin','admin','examiner'), async (req, res) => {
  try {
    const db = getDB();
    const { title, description, subject_id, exam_type, duration_minutes, total_marks, pass_marks, instructions, settings, question_ids, scheduled_at, question_config } = req.body;
    const id = uuidv4();
    const defaultSettings = { shuffle_questions:false, shuffle_options:false, show_timer:true, allow_back:true, auto_submit:true, proctoring:{face_detection:true,gaze_tracking:true,audio_monitoring:true,tab_monitoring:true,screenshot_blocking:true}, ...(settings||{}), shuffle_questions:false, shuffle_options:false };
    await db.execute(
      `INSERT INTO exams (id,title,description,subject_id,exam_type,duration_minutes,total_marks,pass_marks,instructions,settings,question_config,scheduled_at,status,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'scheduled',?)`,
      [id,title,description,subject_id,exam_type,duration_minutes,total_marks,pass_marks,instructions,JSON.stringify(defaultSettings),JSON.stringify(question_config||{}),scheduled_at||null,req.user.id]
    );
    if (question_ids?.length) {
      for (let i=0;i<question_ids.length;i++)
        await db.execute('INSERT INTO exam_questions (id,exam_id,question_id,display_order) VALUES (?,?,?,?)',[uuidv4(),id,question_ids[i],i+1]);
    }
    const [newExam] = await db.execute('SELECT * FROM exams WHERE id=?',[id]);
    res.status(201).json({ exam: newExam[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/exams/:id
router.put('/:id', authenticate, authorize('superadmin','admin','examiner'), async (req, res) => {
  try {
    const db = getDB();
    const { title, description, duration_minutes, total_marks, pass_marks, instructions, settings, status, scheduled_at } = req.body;
    const safeSettings = { ...safeParseObject(settings), shuffle_options:false, shuffle_questions:false };

    // When ending exam, auto-submit all active/waiting sessions
    if (status === 'completed') {
      const [activeSessions] = await db.execute(
        "SELECT es.* FROM exam_sessions es WHERE es.exam_id=? AND es.status IN ('active','paused','waiting')",
        [req.params.id]
      );
      console.log(`Ending exam ${req.params.id} — processing ${activeSessions.length} sessions`);
      for (const session of activeSessions) {
        try { await autoSubmitSession(db, session); }
        catch (e) { console.error('Failed to submit session', session.id, e.message); }
      }
    }

    await db.execute(
      `UPDATE exams SET title=?, description=?, duration_minutes=?, total_marks=?, pass_marks=?, instructions=?, settings=?, status=?, scheduled_at=? WHERE id=?`,
      [title, description, duration_minutes, total_marks, pass_marks, instructions, JSON.stringify(safeSettings), status, scheduled_at||null, req.params.id]
    );
    res.json({ message: 'Exam updated successfully' });
  } catch (err) {
    console.error('PUT /exams/:id error:', err.message);
    res.status(500).json({ error: 'Update failed: ' + err.message });
  }
});

// GET /api/exams/essay-queue — sessions with essay-type answers, for the grading queue
// Must be registered BEFORE '/:id' below, or Express matches "essay-queue" as an :id first
router.get('/essay-queue', authenticate, authorize('superadmin','admin','examiner'), async (req, res) => {
  try {
    const db = getDB();
    const [rows] = await db.execute(`
      SELECT DISTINCT es.id as session_id, es.answers, es.submitted_at,
             e.title as exam_title, u.full_name as candidate_name
      FROM exam_sessions es
      JOIN exams e ON es.exam_id = e.id
      JOIN users u ON es.candidate_id = u.id
      JOIN exam_questions eq ON eq.exam_id = e.id
      JOIN questions q ON eq.question_id = q.id AND q.question_type = 'essay'
      WHERE es.status = 'submitted'
      ORDER BY es.submitted_at DESC
      LIMIT 100
    `);
    res.json({ sessions: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/exams/:id
router.get('/:id', authenticate, async (req, res) => {
  try {
    const db = getDB();
    const [exams] = await db.execute(
      `SELECT e.*, s.name as subject_name FROM exams e LEFT JOIN subjects s ON e.subject_id=s.id WHERE e.id=?`,
      [req.params.id]
    );
    if (!exams[0]) return res.status(404).json({ error: 'Exam not found' });
    const exam = await autoActivateIfDue(db, exams[0]);
    if (['superadmin','admin','examiner'].includes(req.user.role)) {
      const [questions] = await db.execute(
        `SELECT q.*, eq.display_order, eq.marks_override FROM exam_questions eq JOIN questions q ON eq.question_id=q.id WHERE eq.exam_id=? ORDER BY eq.display_order`,
        [req.params.id]
      );
      exam.questions = questions.map(q => ({ ...q, options: safeParseArray(q.options), correct_answers: safeParseArray(q.correct_answers) }));
    }
    res.json({ exam });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/exams/:id/start-session
router.post('/:id/start-session', authenticate, authorize('candidate'), async (req, res) => {
  try {
    const db = getDB();
    const { device_fingerprint } = req.body;
    const [exams] = await db.execute('SELECT * FROM exams WHERE id=?', [req.params.id]);
    if (!exams[0]) return res.status(404).json({ error: 'Exam not found' });
    const exam = await autoActivateIfDue(db, exams[0]);

    if (!['active','paused'].includes(exam.status)) {
      if (exam.status === 'scheduled') {
        const t = exam.scheduled_at ? new Date(exam.scheduled_at).toLocaleString('en-NG') : 'a future time';
        return res.status(400).json({ error: `Exam has not started yet. Scheduled for ${t}.` });
      }
      if (['completed','archived'].includes(exam.status)) return res.status(400).json({ error: 'This exam has already ended.' });
      return res.status(400).json({ error: `Exam not available (${exam.status}).` });
    }

    const settings = safeParseObject(exam.settings);
    const [existing] = await db.execute('SELECT * FROM exam_sessions WHERE exam_id=? AND candidate_id=?', [req.params.id, req.user.id]);
    if (existing[0]?.status === 'submitted') return res.status(409).json({ error: 'You have already submitted this exam.' });
    if (existing[0]?.status === 'disqualified') return res.status(403).json({ error: 'You have been disqualified from this exam.' });

    const [rawQuestions] = await db.execute(
      `SELECT q.id, q.question_text, q.question_type, q.options, q.marks,
       CASE WHEN eq.marks_override IS NOT NULL THEN eq.marks_override ELSE q.marks END as final_marks
       FROM exam_questions eq JOIN questions q ON eq.question_id=q.id WHERE eq.exam_id=? ORDER BY eq.display_order`,
      [req.params.id]
    );
    if (rawQuestions.length === 0) return res.status(400).json({ error: 'This exam has no questions yet.' });

    const questionData = rawQuestions.map(q => ({
      id: q.id, question_text: q.question_text,
      question_type: q.question_type, marks: q.final_marks,
      options: safeParseArray(q.options),
    }));
    const questionOrder = rawQuestions.map(q => q.id);

    // Resume or activate existing session (including 'waiting' sessions)
    if (existing[0]) {
      // ── KEY FIX: activate waiting sessions ──
      if (existing[0].status === 'waiting') {
        await db.execute(
          "UPDATE exam_sessions SET status='active', started_at=NOW() WHERE id=?",
          [existing[0].id]
        );
        existing[0].status = 'active';
        existing[0].started_at = new Date();
      }

      const remaining = getTimeRemaining(existing[0], exam.duration_minutes);
      if (remaining === 0 && existing[0].status !== 'waiting') {
        await autoSubmitSession(db, existing[0]);
        const [done] = await db.execute('SELECT * FROM exam_sessions WHERE id=?', [existing[0].id]);
        return res.json({ session: { ...done[0], time_remaining_seconds: 0 }, questions: questionData, exam: { ...exam, settings }, auto_submitted: true });
      }
      return res.json({ session: { ...existing[0], time_remaining_seconds: remaining }, questions: questionData, exam: { ...exam, settings } });
    }

    // Create brand new session
    const sessionId = uuidv4();
    await db.execute(
      `INSERT INTO exam_sessions (id,exam_id,candidate_id,status,answers,question_order,device_fingerprint,ip_address,started_at) VALUES (?,?,?,'active','{}',?,?,?,NOW())`,
      [sessionId, req.params.id, req.user.id, JSON.stringify(questionOrder), JSON.stringify(device_fingerprint||{}), req.ip]
    );
    const [session] = await db.execute('SELECT * FROM exam_sessions WHERE id=?', [sessionId]);
    session[0].time_remaining_seconds = exam.duration_minutes * 60;
    res.json({ session: session[0], questions: questionData, exam: { ...exam, settings } });
  } catch (err) {
    console.error('start-session error:', err.message);
    res.status(500).json({ error: 'Failed to start exam: ' + err.message });
  }
});

// POST /api/exams/sessions/:sessionId/questions/:questionId/grade-essay
// AI-assisted grading suggestion for an essay-type answer. This is advisory —
// it writes a suggested score/feedback alongside the answer but never
// overwrites the session's official score; an examiner reviews and applies it.
router.post('/sessions/:sessionId/questions/:questionId/grade-essay',
  authenticate, authorize('superadmin','admin','examiner'), async (req, res) => {
  try {
    const db = getDB();
    const { sessionId, questionId } = req.params;

    const [sessionRows] = await db.execute('SELECT * FROM exam_sessions WHERE id=?', [sessionId]);
    if (!sessionRows[0]) return res.status(404).json({ error: 'Session not found' });

    const [questionRows] = await db.execute(
      `SELECT q.question_text, q.explanation, q.marks
       FROM exam_questions eq JOIN questions q ON eq.question_id=q.id
       WHERE eq.exam_id=? AND q.id=?`,
      [sessionRows[0].exam_id, questionId]
    );
    if (!questionRows[0]) return res.status(404).json({ error: 'Question not found on this exam' });
    const question = questionRows[0];

    const answers = safeParseObject(sessionRows[0].answers);
    const candidateAnswer = extractAnswer(answers[questionId]);
    if (!candidateAnswer || !candidateAnswer.trim()) {
      return res.status(400).json({ error: 'Candidate did not answer this question' });
    }
    if (!question.explanation || !question.explanation.trim()) {
      return res.status(400).json({ error: 'This question has no marking guide (explanation field) set — add one before AI grading' });
    }

    const grading = await gradeEssayWithAI({
      question_text: question.question_text,
      model_answer: question.explanation,
      candidate_answer: candidateAnswer,
      max_marks: parseFloat(question.marks) || 10,
    });

    // Store the suggestion alongside the answer — advisory only, not applied to score automatically
    answers[questionId] = { ...answers[questionId], ai_grade: grading, ai_graded_at: new Date().toISOString() };
    await db.execute('UPDATE exam_sessions SET answers=? WHERE id=?', [JSON.stringify(answers), sessionId]);

    res.json({ grading });
  } catch (err) {
    console.error('grade-essay error:', err.message);
    res.status(500).json({ error: 'AI grading failed: ' + err.message });
  }
});

// POST /api/exams/sessions/:sessionId/questions/:questionId/apply-essay-score
// Examiner confirms a final mark for an essay-type answer (whether AI-suggested
// or manually decided) and it gets added into the session's official score.
// Safe to call again if the examiner changes their mind — it replaces, not stacks.
router.post('/sessions/:sessionId/questions/:questionId/apply-essay-score',
  authenticate, authorize('superadmin','admin','examiner'), async (req, res) => {
  try {
    const db = getDB();
    const { sessionId, questionId } = req.params;
    const { score } = req.body;
    if (score === undefined || isNaN(Number(score)) || Number(score) < 0) {
      return res.status(400).json({ error: 'A valid non-negative score is required' });
    }

    const [sessionRows] = await db.execute('SELECT * FROM exam_sessions WHERE id=?', [sessionId]);
    if (!sessionRows[0]) return res.status(404).json({ error: 'Session not found' });
    const session = sessionRows[0];

    const [qRows] = await db.execute(
      `SELECT q.marks FROM exam_questions eq JOIN questions q ON eq.question_id=q.id
       WHERE eq.exam_id=? AND q.id=?`,
      [session.exam_id, questionId]
    );
    if (!qRows[0]) return res.status(404).json({ error: 'Question not found on this exam' });
    const maxMarks = parseFloat(qRows[0].marks) || 0;
    if (Number(score) > maxMarks) {
      return res.status(400).json({ error: `Score cannot exceed this question's max marks (${maxMarks})` });
    }

    const answers = safeParseObject(session.answers);
    const previouslyAwarded = parseFloat(answers[questionId]?.awarded_score) || 0;
    const delta = Number(score) - previouslyAwarded;

    answers[questionId] = { ...answers[questionId], awarded_score: Number(score), graded_by: req.user.id, graded_at: new Date().toISOString() };

    const newScore = (parseFloat(session.score) || 0) + delta;
    const [allExamQuestions] = await db.execute(
      `SELECT CASE WHEN eq.marks_override IS NOT NULL THEN eq.marks_override ELSE q.marks END as m
       FROM exam_questions eq JOIN questions q ON eq.question_id=q.id WHERE eq.exam_id=?`,
      [session.exam_id]
    );
    const totalMarks = allExamQuestions.reduce((sum, r) => sum + (parseFloat(r.m) || 0), 0);
    const newPercentage = totalMarks > 0 ? (newScore / totalMarks) * 100 : 0;

    await db.execute(
      'UPDATE exam_sessions SET answers=?, score=?, percentage=? WHERE id=?',
      [JSON.stringify(answers), newScore, newPercentage, sessionId]
    );

    res.json({ score: newScore, percentage: newPercentage });
  } catch (err) {
    console.error('apply-essay-score error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/exams/sessions/:sessionId/essay-answers — essay questions + candidate answers for grading
router.get('/sessions/:sessionId/essay-answers', authenticate, authorize('superadmin','admin','examiner'), async (req, res) => {
  try {
    const db = getDB();
    const [sessionRows] = await db.execute(
      `SELECT es.*, e.title as exam_title, u.full_name as candidate_name
       FROM exam_sessions es JOIN exams e ON es.exam_id=e.id JOIN users u ON es.candidate_id=u.id
       WHERE es.id=?`, [req.params.sessionId]
    );
    if (!sessionRows[0]) return res.status(404).json({ error: 'Session not found' });
    const session = sessionRows[0];

    const [questions] = await db.execute(
      `SELECT q.id, q.question_text, q.explanation, q.marks
       FROM exam_questions eq JOIN questions q ON eq.question_id=q.id
       WHERE eq.exam_id=? AND q.question_type='essay'`,
      [session.exam_id]
    );

    const answers = safeParseObject(session.answers);
    const items = questions.map(q => ({
      question_id: q.id,
      question_text: q.question_text,
      marking_guide: q.explanation || null,
      max_marks: parseFloat(q.marks) || 0,
      candidate_answer: extractAnswer(answers[q.id]),
      ai_grade: answers[q.id]?.ai_grade || null,
      awarded_score: answers[q.id]?.awarded_score ?? null,
    }));

    res.json({ exam_title: session.exam_title, candidate_name: session.candidate_name, items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
