const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('../models/db');
const { authenticate, optionalAuthenticate, authorize } = require('../middleware/auth');
const { generateQuestionsWithAI, extractQuestionsFromImage, explainAnswer, parseGeminiError, EXPLANATION_BLOCKED_MARKER } = require('../ai/questionGenerator');
const { cleanMathNotation, cleanQuestionFields } = require('../utils/mathNotation');
const { FREE_QUESTION_LIMIT, hasActivePaidPlan, getRemainingQuota, consumeQuota } = require('../services/freeTrial');
const AdmZip = require('adm-zip');
const sharp = require('sharp');

const router = express.Router();

// Some earlier import path (a CSV mapping or a manual data-entry slip — the
// exact source is lost to history) left plenty of questions with their
// `explanation` column set to nothing more than the answer letter itself:
// "A", "A.", "(A)", "Option A", "Answer: A". That's not an explanation, it's
// the same thing the "correct answer" checkmark already shows — but because
// it's non-empty, the generate-explanation cache check below (and the
// client's ExplanationBox) both treat it as "already has a real explanation"
// and never call the AI at all. Detect that specific shape and treat it as
// equivalent to missing, so these questions get a real explanation generated
// instead of being silently skipped forever.
function isBareAnswerLetter(text) {
  if (!text) return true;
  let t = text.trim();
  if (!t) return true;
  // Strip common prefixes so "Option A", "Answer: A", "The answer is A" all
  // reduce to just "A" before the final bare-letter check — a plain regex
  // without this step either misses those phrasings or false-positives on
  // genuine explanations that happen to start with the word "Answer".
  t = t.replace(/^(the\s+)?(correct\s+)?answer\s*(is|:)?\s*/i, '');
  t = t.replace(/^option\s*/i, '');
  t = t.trim();
  return /^\(?[A-Ea-e]\)?\.?$/.test(t);
}

// ── Image upload (question diagrams/graphs) ──
const uploadDir = path.join(__dirname, '..', 'uploads', 'questions');
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${uuidv4()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  },
});

// POST /api/questions/upload-image  ← must be BEFORE /:id
router.post('/upload-image', authenticate, authorize('superadmin', 'admin', 'examiner'), (req, res) => {
  upload.single('image')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Upload failed' });
    if (!req.file) return res.status(400).json({ error: 'No image file provided' });
    const url = `/uploads/questions/${req.file.filename}`;
    res.status(201).json({ url });
  });
});

// ── IMPORTANT: Specific routes MUST come before /:id routes ──

// GET /api/questions/subjects/list  ← must be FIRST before /:id
router.get('/subjects/list', authenticate, async (req, res) => {
  try {
    const db = getDB();
    const [subjects] = await db.execute('SELECT * FROM subjects ORDER BY name');
    res.json({ subjects });
  } catch (err) {
    console.error('subjects/list error:', err.message);
    res.status(500).json({ error: 'Failed to fetch subjects' });
  }
});

// POST /api/questions/bulk  ← must be BEFORE /:id
router.post('/bulk', authenticate, authorize('superadmin', 'admin', 'examiner'), async (req, res) => {
  try {
    const db = getDB();
    const { questions } = req.body;

    if (!Array.isArray(questions) || !questions.length) {
      return res.status(400).json({ error: 'Questions array required' });
    }

    const results = { success: 0, failed: 0, errors: [] };

    for (const q of questions) {
      try {
        if (!q.question_text?.trim()) {
          results.failed++;
          results.errors.push({ error: 'Missing question_text', question: '(empty)' });
          continue;
        }
        const id = uuidv4();
        await db.execute(
          `INSERT INTO questions
           (id, subject_id, question_text, question_type, options,
            correct_answers, explanation, difficulty, marks, tags, media_url, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            q.subject_id || null,
            q.question_text.trim(),
            q.question_type || 'mcq',
            JSON.stringify(Array.isArray(q.options) ? q.options : []),
            JSON.stringify(Array.isArray(q.correct_answers) ? q.correct_answers : []),
            q.explanation || null,
            ['easy','medium','hard'].includes(q.difficulty) ? q.difficulty : 'medium',
            parseFloat(q.marks) || 1,
            JSON.stringify(Array.isArray(q.tags) ? q.tags : []),
            q.media_url || null,
            req.user.id,
          ]
        );
        results.success++;
      } catch (err) {
        results.failed++;
        results.errors.push({
          question: q.question_text?.substring(0, 50),
          error: err.message,
        });
      }
    }

    res.json(results);
  } catch (err) {
    console.error('bulk upload error:', err.message);
    res.status(500).json({ error: 'Bulk upload failed: ' + err.message });
  }
});

// POST /api/questions/ai-generate  ← must be BEFORE /:id
router.post('/ai-generate', authenticate, authorize('superadmin', 'admin', 'examiner'), async (req, res) => {
  try {
    const { subject, topic, difficulty, count = 5, exam_type } = req.body;

    if (!subject || !topic) {
      return res.status(400).json({ error: 'Subject and topic are required' });
    }
    if (count > 20) {
      return res.status(400).json({ error: 'Maximum 20 questions per generation' });
    }

    const questions = await generateQuestionsWithAI({
      subject, topic, difficulty: difficulty || 'medium',
      count: Number(count), exam_type,
    });
    res.json({ questions });
  } catch (err) {
    console.error('AI generation error:', err.message);
    res.status(500).json({ error: 'AI question generation failed: ' + err.message });
  }
});

// GET /api/questions  ← list all questions
router.get('/', optionalAuthenticate, async (req, res) => {
  try {
    const db = getDB();
    const {
      subject_id, subject, difficulty, type, exam_type, paper_type, year, search, topic_id,
      page = 1, limit = 25,
    } = req.query;

    const limitNum = Math.max(1, Math.min(200, Number(limit) || 25));
    const pageNum = Math.max(1, Number(page) || 1);
    const offsetNum = (pageNum - 1) * limitNum;

    // Free-trial gate: 5 free questions before being asked to subscribe.
    // Two cases share the same quota logic (see services/freeTrial.js):
    //  - A logged-in candidate without a paid plan, keyed by their user id.
    //  - A completely anonymous visitor hitting "Practice Free" from the
    //    landing page with no account at all — this route used to require
    //    `authenticate`, which meant an anonymous visitor got a 401 on their
    //    very first question and was bounced straight to /login before ever
    //    seeing a question. Now it's optionalAuthenticate, and an anonymous
    //    request is tracked by a client-generated x-anon-id header instead
    //    of a user id (see utils/anonId.js on the client) — same table, same
    //    5-question limit, just a different kind of key. Staff roles
    //    (admin/examiner/etc.) never hit this either way.
    let effectiveLimit = limitNum;
    let freeTrial = null;
    const isAnonymous = !req.user;
    const anonId = req.headers['x-anon-id'];
    // The 5-free-question gate applies ONLY to a completely anonymous
    // "Practice Free" visitor with no account at all. An enrolled candidate
    // who logs in with their surname/reg-number (see routes/auth.js) is
    // already accounted for by their school and gets full, unrestricted
    // access — this used to also gate any authenticated role==='candidate'
    // account, which wrongly capped real enrolled students at 5 questions
    // too. Only the truly external, not-logged-in visitor gets limited now.
    // Wrapped in its own try/catch, separate from the rest of the route —
    // this gate is a nice-to-have (monetization), not core functionality.
    // A failure here used to bubble all the way up and 500 the ENTIRE
    // question fetch, which is exactly why "Practice Free" was falling back
    // to demo questions — one gate bug broke the whole endpoint for
    // everyone, paid or not, anonymous or not.
    try {
      if (isAnonymous) {
        const quotaKey = anonId ? `anon:${anonId}` : null;
        // No anon id sent at all — can't track this visitor's quota, so
        // rather than either trusting them unlimited or blocking outright,
        // fall back to serving normally-limited results with no free-trial
        // bookkeeping. In practice the client always sends this (see
        // main.jsx), so this is just a safety fallback, not the expected path.
        if (quotaKey) {
          const remaining = await getRemainingQuota(db, quotaKey);
          if (remaining <= 0) {
            return res.status(402).json({
              error: `You've used all ${FREE_QUESTION_LIMIT} free questions. Log in or subscribe to keep practicing.`,
              code: 'FREE_LIMIT_REACHED',
              free_limit: FREE_QUESTION_LIMIT,
            });
          }
          effectiveLimit = Math.min(limitNum, remaining);
          freeTrial = { remaining_before: remaining, limit: FREE_QUESTION_LIMIT, quotaKey };
        }
      }
    } catch (gateErr) {
      console.error('Free-trial gate error (falling through, serving questions normally):', gateErr.message);
      effectiveLimit = limitNum;
      freeTrial = null;
    }

    let where = 'q.is_active = TRUE';
    const params = [];

    // Practice Free (the anonymous, no-account flow) must be strictly
    // objective — theory/essay questions can't be auto-graded or explained
    // the same instant way objective ones can, so they don't belong in a
    // quick unauthenticated trial. This overrides any `type=essay` a client
    // might pass, rather than just being the default when no type filter is
    // given — an anonymous request is never allowed to pull essay questions,
    // full stop. Enrolled candidates who actually log in are unaffected —
    // they get every question type, this only narrows the anonymous path.
    if (isAnonymous) {
      where += " AND q.question_type != 'essay'";
    }

    if (subject_id) { where += ' AND q.subject_id = ?'; params.push(subject_id); }
    if (subject && subject !== 'All') { where += ' AND s.name = ?'; params.push(subject); }
    if (difficulty)  { where += ' AND q.difficulty = ?';  params.push(difficulty); }
    if (type)        { where += ' AND q.question_type = ?'; params.push(type); }
    if (topic_id)    { where += ' AND q.topic_id = ?'; params.push(topic_id); }
    // Matches both the new structured `exam_body` column (questions published
    // through the Milestone 3 pipeline) AND the older `exam_types` JSON array
    // (manually-created questions from before that column existed) — so
    // filtering keeps working across both without needing a data migration.
    if (exam_type && exam_type !== 'CUSTOM') {
      where += ' AND (q.exam_body = ? OR JSON_CONTAINS(q.exam_types, ?))';
      params.push(exam_type, JSON.stringify(exam_type));
    }
    if (paper_type && paper_type !== 'All') { where += ' AND q.paper_type = ?'; params.push(paper_type); }
    if (year && year !== 'All Years' && year !== 'All') { where += ' AND JSON_CONTAINS(q.tags, ?)'; params.push(JSON.stringify(String(year))); }
    if (search)      { where += ' AND q.question_text LIKE ?'; params.push(`%${search}%`); }

    // LIMIT/OFFSET must be inlined, not passed as `?` placeholders — mysql2's
    // execute() (prepared statements) frequently throws "Incorrect arguments
    // to mysqld_stmt_execute" when LIMIT/OFFSET are parameterized. Safe to
    // inline here since both are forced through Number()/clamping above.
    // Numbered questions (imported with a known printed question number) sort
    // in that original order first; anything without a number (older manual
    // entries, AI-generated questions) falls back to newest-first after them.
    // Objective questions sort before theory/essay ones (matching the usual
    // WAEC/NECO/JAMB paper convention — Section A objective 1–50, Section B
    // theory below/after) — otherwise interleaved question_numbers from
    // different sections (each often restarting at 1) could mix them
    // together instead of keeping objective first, theory after.
    const [questions] = await db.execute(
      `SELECT q.*, s.name as subject_name, u.full_name as created_by_name
       FROM questions q
       LEFT JOIN subjects s ON q.subject_id = s.id
       LEFT JOIN users u ON q.created_by = u.id
       WHERE ${where}
       ORDER BY (q.question_type = 'essay') ASC, (q.question_number IS NULL) ASC, q.question_number ASC, q.created_at DESC
       LIMIT ${effectiveLimit} OFFSET ${offsetNum}`,
      params
    );

    const [[{ total }]] = await db.execute(
      `SELECT COUNT(*) as total FROM questions q LEFT JOIN subjects s ON q.subject_id = s.id WHERE ${where}`,
      params
    );

    let freeTrialStatus;
    if (freeTrial) {
      try {
        // Only consume quota for what was actually handed back — if fewer
        // questions matched the filters than the trial had left, no sense
        // burning unused quota on questions that were never served.
        const consumed = await consumeQuota(db, freeTrial.quotaKey, questions.length);
        freeTrialStatus = {
          limit: freeTrial.limit,
          remaining: Math.max(0, freeTrial.remaining_before - consumed),
        };
      } catch (consumeErr) {
        console.error('Free-trial consume error (questions already fetched, serving anyway):', consumeErr.message);
      }
    }

    res.json({ questions, total, free_trial: freeTrialStatus });
  } catch (err) {
    console.error('GET /questions error:', err.message);
    res.status(500).json({ error: 'Failed to fetch questions: ' + err.message });
  }
});

// POST /api/questions  ← create single question
router.post('/', authenticate, authorize('superadmin', 'admin', 'examiner'), async (req, res) => {
  try {
    const db = getDB();
    const {
      subject_id, question_text, question_type = 'mcq',
      options, correct_answers, explanation,
      difficulty = 'medium', marks = 1,
      tags, media_url, exam_types,
    } = req.body;

    if (!question_text?.trim()) {
      return res.status(400).json({ error: 'Question text is required' });
    }

    // Validate difficulty
    const validDiff = ['easy', 'medium', 'hard'].includes(difficulty) ? difficulty : 'medium';

    // Validate question_type
    const validTypes = ['mcq','multi_answer','essay','true_false','fill_blank','coding','drag_drop'];
    const validType = validTypes.includes(question_type) ? question_type : 'mcq';

    const id = uuidv4();
    await db.execute(
      `INSERT INTO questions
       (id, subject_id, question_text, question_type, options,
        correct_answers, explanation, difficulty, marks,
        tags, media_url, exam_types, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        subject_id || null,
        question_text.trim(),
        validType,
        JSON.stringify(Array.isArray(options) ? options : []),
        JSON.stringify(Array.isArray(correct_answers) ? correct_answers : []),
        explanation || null,
        validDiff,
        parseFloat(marks) || 1,
        JSON.stringify(Array.isArray(tags) ? tags : []),
        media_url || null,
        JSON.stringify(Array.isArray(exam_types) ? exam_types : []),
        req.user.id,
      ]
    );

    const [q] = await db.execute('SELECT * FROM questions WHERE id = ?', [id]);
    res.status(201).json({ question: q[0] });
  } catch (err) {
    console.error('POST /questions error:', err.message);
    res.status(500).json({ error: 'Failed to create question: ' + err.message });
  }
});

// GET /api/questions/:id
router.get('/:id', authenticate, async (req, res) => {
  try {
    const db = getDB();
    const [questions] = await db.execute(
      `SELECT q.*, s.name as subject_name
       FROM questions q
       LEFT JOIN subjects s ON q.subject_id = s.id
       WHERE q.id = ?`,
      [req.params.id]
    );
    if (!questions[0]) {
      return res.status(404).json({ error: 'Question not found' });
    }
    res.json({ question: questions[0] });
  } catch (err) {
    console.error('GET /questions/:id error:', err.message);
    res.status(500).json({ error: 'Failed to fetch question' });
  }
});

// PUT /api/questions/:id
router.put('/:id', authenticate, authorize('superadmin', 'admin', 'examiner'), async (req, res) => {
  try {
    const db = getDB();
    const {
      question_text, question_type, options, correct_answers,
      explanation, difficulty, marks, tags, media_url, exam_types, subject_id,
    } = req.body;

    if (!question_text?.trim()) {
      return res.status(400).json({ error: 'Question text is required' });
    }

    await db.execute(
      `UPDATE questions SET
       subject_id=?, question_text=?, question_type=?,
       options=?, correct_answers=?, explanation=?,
       difficulty=?, marks=?, tags=?, media_url=?,
       exam_types=?, version = version + 1
       WHERE id = ?`,
      [
        subject_id || null,
        question_text.trim(),
        question_type || 'mcq',
        JSON.stringify(Array.isArray(options) ? options : []),
        JSON.stringify(Array.isArray(correct_answers) ? correct_answers : []),
        explanation || null,
        difficulty || 'medium',
        parseFloat(marks) || 1,
        JSON.stringify(Array.isArray(tags) ? tags : []),
        media_url || null,
        JSON.stringify(Array.isArray(exam_types) ? exam_types : []),
        req.params.id,
      ]
    );

    res.json({ message: 'Question updated successfully' });
  } catch (err) {
    console.error('PUT /questions/:id error:', err.message);
    res.status(500).json({ error: 'Failed to update question: ' + err.message });
  }
});

// DELETE /api/questions/:id  (soft delete)
router.delete('/:id', authenticate, authorize('superadmin', 'admin'), async (req, res) => {
  try {
    const db = getDB();
    await db.execute(
      'UPDATE questions SET is_active = FALSE WHERE id = ?',
      [req.params.id]
    );
    res.json({ message: 'Question deactivated successfully' });
  } catch (err) {
    console.error('DELETE /questions/:id error:', err.message);
    res.status(500).json({ error: 'Failed to delete question' });
  }
});

// POST /api/questions/:id/generate-explanation — fills in a missing
// explanation on demand (e.g. a student reveals an answer on a question that
// was imported/created without one). Persists the result back onto the
// question row, so this only ever runs once per question globally — every
// later view of the same question gets the cached explanation straight from
// the DB with no further AI call. Any authenticated user can trigger this
// (not admin-only) since it's routinely hit by candidates reviewing their
// own answers, not just staff.
// Optionally authenticated for the same reason as GET '/' above — an
// anonymous "Practice Free" visitor needs explanations for their 5 free
// questions too, and this endpoint doesn't do anything user-specific (it
// only reads/writes the shared question row), so there's nothing here that
// actually needs a real account.
router.post('/:id/generate-explanation', optionalAuthenticate, async (req, res) => {
  try {
    const db = getDB();
    const [rows] = await db.execute(
      `SELECT q.id, q.question_text, q.question_type, q.options, q.correct_answers, q.explanation, s.name AS subject_name
       FROM questions q LEFT JOIN subjects s ON q.subject_id = s.id
       WHERE q.id = ?`,
      [req.params.id]
    );
    const question = rows[0];
    if (!question) return res.status(404).json({ error: 'Question not found' });

    if (question.explanation && !isBareAnswerLetter(question.explanation)) {
      return res.json({ explanation: question.explanation, cached: true });
    }

    const options = Array.isArray(question.options) ? question.options
      : (() => { try { return JSON.parse(question.options || '[]'); } catch { return []; } })();
    const correct_answers = Array.isArray(question.correct_answers) ? question.correct_answers
      : (() => { try { return JSON.parse(question.correct_answers || '[]'); } catch { return []; } })();

    // Essay/theory questions have no single correct_answers value by design
    // (there's nothing to "match" against) — explainAnswer handles that case
    // with a model-answer-style explanation instead. Only genuinely block
    // objective-type questions that are missing a recorded answer, since
    // there's nothing true to explain from there.
    if (!correct_answers.length && question.question_type !== 'essay') {
      return res.status(400).json({ error: 'This question has no recorded correct answer to explain from' });
    }

    const explanation = await explainAnswer({
      question_text: question.question_text,
      options,
      correct_answers,
      subject: question.subject_name,
      question_type: question.question_type,
    });

    // Persist even the blocked-marker text (see EXPLANATION_BLOCKED_MARKER in
    // questionGenerator.js) — that's deliberate, not a bug: it makes the
    // cached-explanation check above (line ~452) treat this question as
    // "already tried" so it stops re-asking Gemini the same blocked question
    // on every future page view. A real empty string, by contrast, is never
    // written here — explainAnswer only returns '' on a genuine transient
    // failure, which SHOULD be retried on the next view.
    if (explanation) {
      await db.execute('UPDATE questions SET explanation=? WHERE id=?', [explanation, question.id]);
    }
    res.json({ explanation, cached: false, blocked: explanation === EXPLANATION_BLOCKED_MARKER });
  } catch (err) {
    console.error('POST /questions/:id/generate-explanation error:', err.message);
    // 429, not a generic 500 — this is Gemini's rate limit, not our server
    // breaking, and the client (explanationQueue.js) treats these
    // differently: it won't burn retries against a quota that's guaranteed
    // exhausted for the rest of the day, and shows an accurate "try again
    // later" message instead of implying this particular question just
    // can't be explained.
    const geminiErr = parseGeminiError(err);
    const status = geminiErr.isQuotaExceeded ? 429 : 500;
    res.status(status).json({
      error: geminiErr.isQuotaExceeded ? geminiErr.message : 'Failed to generate explanation',
      code: geminiErr.isQuotaExceeded ? 'AI_QUOTA_EXCEEDED' : undefined,
      retry_delay_seconds: geminiErr.retryDelaySeconds || null,
    });
  }
});

// POST /api/questions/backfill-explanations — proactively generates
// explanations for every published question that's missing one, instead of
// waiting for a student to happen to view it first (the old lazy-generate-
// on-reveal approach). Two things this fixes:
//   1. "No matter how simple" coverage — a question nobody's ever opened
//      yet had no explanation until someone did, however trivial it was.
//   2. Offline study — "Save for Offline" (see StudyApp.jsx) snapshots
//      whatever's in the DB at that moment; if an explanation hadn't been
//      generated yet, the offline copy would be missing it, and there's no
//      network to lazily fetch it once actually offline. Pre-populating the
//      DB means every future fetch — live or offline-cached — already has it.
// Processes one bounded batch per call (default 15) rather than the whole
// table at once, so this stays a fast request instead of a long-running one
// that could time out; the caller (admin UI, or the offline-save flow) calls
// this repeatedly until `remaining` hits 0 or `quota_exceeded` comes back.
router.post('/backfill-explanations', authenticate, async (req, res) => {
  try {
    const db = getDB();
    const limit = Math.max(1, Math.min(50, Number(req.body?.limit) || 15));
    const { subject_id, exam_type, ids } = req.body || {};

    // Broaden the SQL fetch beyond a strict empty check to also catch the
    // isBareAnswerLetter placeholder pattern ("A", "Option A", "The answer is
    // A" — see that function's comment above) — SQL can't run that exact JS
    // check, so pull in anything short enough to PLAUSIBLY be one of those
    // (a real explanation is essentially never this short) and filter
    // precisely in JS below. This keeps the two "does this need a real
    // explanation" checks in this file — this one and the single-question
    // route above — actually consistent with each other.
    let where = "q.is_active = TRUE AND (q.explanation IS NULL OR CHAR_LENGTH(TRIM(q.explanation)) <= 20)";
    const params = [];
    if (subject_id) { where += ' AND q.subject_id = ?'; params.push(subject_id); }
    if (exam_type)  { where += ' AND JSON_CONTAINS(q.exam_types, ?)'; params.push(JSON.stringify(exam_type)); }
    if (Array.isArray(ids) && ids.length) {
      where += ` AND q.id IN (${ids.map(() => '?').join(',')})`;
      params.push(...ids);
    }

    // Overfetch a little beyond `limit` before the precise JS filter below,
    // since the broadened SQL condition above can match some short-but-real
    // explanations that isBareAnswerLetter will correctly rule back out —
    // without this, a batch could come back smaller than `limit` even though
    // plenty of genuinely-missing questions remain.
    const [candidateRows] = await db.execute(
      `SELECT q.id, q.question_text, q.question_type, q.options, q.correct_answers, q.explanation, s.name AS subject_name
       FROM questions q LEFT JOIN subjects s ON q.subject_id = s.id
       WHERE ${where} LIMIT ${limit * 4}`,
      params
    );
    const rows = candidateRows
      .filter(q => !q.explanation || isBareAnswerLetter(q.explanation))
      .slice(0, limit);

    // Precise count of what's actually left, using the same JS filter as the
    // batch fetch above rather than the broader SQL condition alone (which
    // over-counts — it also matches short-but-genuine explanations that
    // isBareAnswerLetter correctly rules back out). Capped at 2000 candidates
    // — this only needs to be "accurate enough for a progress indicator", not
    // exact against an unbounded table, and the loop terminates correctly
    // either way via the generated===0 stop condition below.
    const countRemaining = async () => {
      const [candidates] = await db.execute(
        `SELECT q.explanation FROM questions q WHERE ${where} LIMIT 2000`, params
      );
      return candidates.filter(q => !q.explanation || isBareAnswerLetter(q.explanation)).length;
    };

    let generated = 0, failed = 0;
    for (const question of rows) {
      let options, correct_answers;
      try { options = Array.isArray(question.options) ? question.options : JSON.parse(question.options || '[]'); } catch { options = []; }
      try { correct_answers = Array.isArray(question.correct_answers) ? question.correct_answers : JSON.parse(question.correct_answers || '[]'); } catch { correct_answers = []; }

      if (!correct_answers.length && question.question_type !== 'essay') { failed++; continue; }

      try {
        const explanation = await explainAnswer({
          question_text: question.question_text,
          options, correct_answers,
          subject: question.subject_name,
          question_type: question.question_type,
        });
        await db.execute('UPDATE questions SET explanation=? WHERE id=?', [explanation, question.id]);
        generated++;
      } catch (err) {
        const geminiErr = parseGeminiError(err);
        if (geminiErr.isQuotaExceeded) {
          // Stop the whole batch here — every remaining question in it (and
          // any future call today) will fail the same way. Report what's
          // left so the caller knows to stop looping and try again later.
          const remaining = await countRemaining();
          return res.json({ generated, failed, remaining, quota_exceeded: true, retry_delay_seconds: geminiErr.retryDelaySeconds || null });
        }
        console.error(`backfill-explanations: failed on question ${question.id}:`, err.message);
        failed++;
      }
    }

    const remaining = await countRemaining();
    res.json({ generated, failed, remaining, quota_exceeded: false });
  } catch (err) {
    console.error('POST /questions/backfill-explanations error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/questions/clean-math-notation — LEGACY, from before the client
// rendered LaTeX at all. Back then $x^2$ showed up as raw ugly syntax to
// students, so this route flattened it to Unicode approximations. That's no
// longer true: MathText.jsx now renders $...$ with real KaTeX, so this route
// (and the cleanMathNotation() it calls) would actively DESTROY good LaTeX —
// stripping the $ delimiters and collapsing fractions/roots to lossy plain
// text — if run today. cleanMathNotation() itself now leaves $...$ spans
// alone (see utils/mathNotation.js), so this route is effectively inert, but
// it's kept superadmin-only and undocumented in the admin UI on purpose.
// Don't wire this into a button without re-reading this comment first.
router.post('/clean-math-notation', authenticate, authorize('superadmin'), async (req, res) => {
  try {
    const db = getDB();
    const { subject_id, exam_body } = req.query;
    let where = 'is_active = TRUE'; const params = [];
    if (subject_id) { where += ' AND subject_id=?'; params.push(subject_id); }
    if (exam_body)  { where += ' AND exam_body=?'; params.push(exam_body); }

    const [rows] = await db.execute(
      `SELECT id, question_text, options, explanation FROM questions WHERE ${where}`,
      params
    );

    let updated = 0, skipped = 0;
    for (const row of rows) {
      const cleanedText = cleanMathNotation(row.question_text);

      // `options` is a native MySQL JSON column, so mysql2 already returns it
      // as a parsed array — NOT a string. Calling JSON.parse() on an array
      // silently fails (array.toString() isn't valid JSON), which is exactly
      // the bug that wiped options to [] before. Never guess here: if it's
      // not already an array and isn't a parseable string, skip the row
      // entirely rather than writing anything back.
      let originalOptions;
      if (Array.isArray(row.options)) {
        originalOptions = row.options;
      } else if (typeof row.options === 'string') {
        try { originalOptions = JSON.parse(row.options || '[]'); }
        catch { skipped++; continue; }
      } else {
        skipped++; continue;
      }

      const cleanedOptions = originalOptions.map(o => typeof o === 'string' ? cleanMathNotation(o) : o);
      const cleanedExplanation = row.explanation ? cleanMathNotation(row.explanation) : row.explanation;

      const textChanged = cleanedText !== row.question_text;
      const optionsChanged = JSON.stringify(cleanedOptions) !== JSON.stringify(originalOptions);
      const explanationChanged = cleanedExplanation !== row.explanation;

      if (textChanged || optionsChanged || explanationChanged) {
        await db.execute(
          'UPDATE questions SET question_text=?, options=?, explanation=? WHERE id=?',
          [cleanedText, JSON.stringify(cleanedOptions), cleanedExplanation, row.id]
        );
        updated++;
      }
    }

    res.json({ message: `Cleaned ${updated} of ${rows.length} question(s) scanned (${skipped} skipped, unparseable)`, scanned: rows.length, updated, skipped });
  } catch (err) {
    console.error('clean-math-notation error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/questions/restore-from-staging — emergency recovery for the
// clean-math-notation data-loss bug above. Any published question that came
// through the batch import pipeline still has its original, untouched
// options/correct_answers sitting in staged_questions (that table was never
// touched by the buggy script). This copies them back for any live question
// whose options are currently empty. Does NOT help questions imported
// through the older, non-staged Import page — those have no backup copy
// anywhere and need to be re-imported from the original source file.
router.post('/restore-from-staging', authenticate, authorize('superadmin', 'admin'), async (req, res) => {
  try {
    const db = getDB();
    const [rows] = await db.execute(
      `SELECT q.id, q.options as live_options, sq.options as staged_options, sq.correct_answers as staged_correct
       FROM questions q
       JOIN staged_questions sq ON sq.published_question_id = q.id
       WHERE q.is_active = TRUE`
    );

    let restored = 0, alreadyFine = 0;
    for (const row of rows) {
      let liveOptions;
      if (Array.isArray(row.live_options)) liveOptions = row.live_options;
      else { try { liveOptions = JSON.parse(row.live_options || '[]'); } catch { liveOptions = []; } }

      if (liveOptions.length > 0) { alreadyFine++; continue; }

      let stagedOptions = Array.isArray(row.staged_options) ? row.staged_options
        : (() => { try { return JSON.parse(row.staged_options || '[]'); } catch { return []; } })();
      let stagedCorrect = Array.isArray(row.staged_correct) ? row.staged_correct
        : (() => { try { return JSON.parse(row.staged_correct || '[]'); } catch { return []; } })();

      if (stagedOptions.length === 0) continue; // staging copy also empty — nothing to restore from

      await db.execute(
        'UPDATE questions SET options=?, correct_answers=? WHERE id=?',
        [JSON.stringify(stagedOptions), JSON.stringify(stagedCorrect), row.id]
      );
      restored++;
    }

    res.json({ message: `Restored ${restored} question(s) from their staging backup`, restored, already_fine: alreadyFine, checked: rows.length });
  } catch (err) {
    console.error('restore-from-staging error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Diagram repair ───────────────────────────────────────────────────────
// For questions already LIVE in the question bank whose media_url points to
// a file that no longer exists (from before a persistent volume was
// attached), a normal re-import doesn't help — duplicate-text detection
// would just skip these as already-existing and never touch their broken
// media_url. This endpoint re-processes the original photos and PATCHES the
// existing rows' media_url directly, matched by question_number (primary)
// or normalized question_text (fallback) within the given exam scope —
// nothing gets inserted as a new row.

const DIAGRAMS_DIR = path.join(__dirname, '..', 'uploads', 'diagrams');

function normaliseText(t) {
  return String(t || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

async function cropDiagram(buffer, box) {
  if (!box || [box.x_min, box.y_min, box.x_max, box.y_max].some(v => typeof v !== 'number')) return null;
  try {
    const img = sharp(buffer);
    const meta = await img.metadata();
    if (!meta.width || !meta.height) return null;
    // 8pt margin, not 3 — see routes/import.js for why. Cropping too tight
    // is unrecoverable; a little extra whitespace around the figure is not.
    const pad = 8;
    const xMin = Math.max(0, box.x_min - pad);
    const yMin = Math.max(0, box.y_min - pad);
    const xMax = Math.min(100, box.x_max + pad);
    const yMax = Math.min(100, box.y_max + pad);
    if (xMax <= xMin || yMax <= yMin) return null;
    const left = Math.round((xMin / 100) * meta.width);
    const top = Math.round((yMin / 100) * meta.height);
    // Clamp so rounding never pushes the extract box past the image bounds.
    const width = Math.min(Math.round(((xMax - xMin) / 100) * meta.width), meta.width - left);
    const height = Math.min(Math.round(((yMax - yMin) / 100) * meta.height), meta.height - top);
    if (width < 20 || height < 20) return null;
    fs.mkdirSync(DIAGRAMS_DIR, { recursive: true });
    const filename = `${uuidv4()}.jpg`;
    await sharp(buffer).extract({ left, top, width, height }).jpeg({ quality: 88 }).toFile(path.join(DIAGRAMS_DIR, filename));
    return `/uploads/diagrams/${filename}`;
  } catch (err) {
    console.error('repair diagram crop failed:', err.message);
    return null;
  }
}

const zipUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 60 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = file.mimetype === 'application/zip' || file.mimetype === 'application/x-zip-compressed'
      || file.originalname.toLowerCase().endsWith('.zip');
    if (ok) cb(null, true); else cb(new Error('Only .zip files are allowed here'));
  },
});

// POST /api/questions/repair-diagrams
router.post('/repair-diagrams', authenticate, authorize('superadmin', 'admin'), (req, res) => {
  zipUpload.single('zip')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Upload failed' });
    if (!req.file) return res.status(400).json({ error: 'No zip file provided' });

    const { exam_body, year, subject_id } = req.body;
    // Normal mode only touches rows whose media_url is missing/broken —
    // that's what this endpoint was originally built for. `force` also
    // re-crops rows whose image file DOES exist, using the wider 8pt margin
    // above, so admins can fix diagrams that imported fine but came out
    // clipped/too-tight under the old 3pt margin, without duplicating rows.
    const force = req.body.force === 'true' || req.body.force === true;
    if (!exam_body || !year) return res.status(400).json({ error: 'exam_body and year are required, to scope which live questions this can match against' });

    let entries;
    try {
      const zip = new AdmZip(req.file.buffer);
      entries = zip.getEntries().filter(e => {
        if (e.isDirectory) return false;
        const name = e.entryName.toLowerCase();
        if (name.includes('__macosx') || name.split('/').pop().startsWith('.')) return false;
        return /\.(jpe?g|png|webp)$/.test(name);
      });
    } catch {
      return res.status(400).json({ error: "Could not read that zip file — make sure it's a valid .zip archive of photos" });
    }
    if (entries.length === 0) return res.status(400).json({ error: 'No JPG/PNG/WEBP photos found inside that zip' });

    const db = getDB();
    let where = '1=1'; const params = [];
    where += ' AND (exam_body = ? OR JSON_CONTAINS(exam_types, ?))'; params.push(exam_body, JSON.stringify(exam_body));
    where += ' AND JSON_CONTAINS(tags, ?)'; params.push(JSON.stringify(String(year)));
    if (subject_id) { where += ' AND subject_id = ?'; params.push(subject_id); }
    const [liveRows] = await db.execute(
      `SELECT id, question_number, question_text, media_url FROM questions WHERE ${where} AND is_active = TRUE`,
      params
    );
    const byNumber = new Map();
    const byText = new Map();
    for (const r of liveRows) {
      if (r.question_number !== null && r.question_number !== undefined) byNumber.set(r.question_number, r);
      byText.set(normaliseText(r.question_text), r);
    }

    const mimeFor = (name) => name.endsWith('.png') ? 'image/png' : name.endsWith('.webp') ? 'image/webp' : 'image/jpeg';

    let repaired = 0, noMatch = 0, noDiagram = 0, alreadyFine = 0, pagesFailed = 0;
    const unmatched = [];

    for (const entry of entries) {
      const filename = entry.entryName.split('/').pop();
      try {
        const buffer = entry.getData();
        const result = await extractQuestionsFromImage({ imageBase64: buffer.toString('base64'), mediaType: mimeFor(filename.toLowerCase()) });
        const pageQuestions = (result.questions || []).filter(q => q.question_text?.trim());

        for (const q of pageQuestions) {
          const cleaned = cleanQuestionFields(q);
          let match = (q.number !== undefined && q.number !== null) ? byNumber.get(q.number) : null;
          if (!match) match = byText.get(normaliseText(cleaned.question_text));

          if (!match) { noMatch++; unmatched.push({ filename, number: q.number ?? null, text: cleaned.question_text.slice(0, 60) }); continue; }
          if (!q.has_diagram) { noDiagram++; continue; }

          // Skip re-cropping if this row's media_url already resolves — UNLESS
          // force is set, in which case we deliberately re-crop it anyway
          // (this is how an already-imported-but-clipped diagram gets fixed).
          if (!force && match.media_url) {
            const existingPath = path.join(__dirname, '..', match.media_url.replace(/^\//, ''));
            if (fs.existsSync(existingPath)) { alreadyFine++; continue; }
          }

          const diagramUrl = await cropDiagram(buffer, q.diagram_box);
          if (!diagramUrl) { noMatch++; continue; }

          await db.execute('UPDATE questions SET media_url=? WHERE id=?', [diagramUrl, match.id]);
          repaired++;
        }
      } catch (photoErr) {
        console.error(`repair-diagrams photo error (${filename}):`, photoErr.message);
        pagesFailed++;
      }
    }

    res.json({
      message: force
        ? `Re-cropped ${repaired} diagram(s) with the wider margin`
        : `Repaired ${repaired} diagram(s)`,
      repaired, already_fine: alreadyFine, no_diagram_needed: noDiagram,
      no_match: noMatch, pages_failed: pagesFailed, force,
      unmatched_sample: unmatched.slice(0, 10),
    });
  });
});

module.exports = router;
