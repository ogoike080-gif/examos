const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('../models/db');
const { authenticate, authorize } = require('../middleware/auth');
const { generateQuestionsWithAI, extractQuestionsFromImage } = require('../ai/questionGenerator');
const { cleanMathNotation, cleanQuestionFields } = require('../utils/mathNotation');
const AdmZip = require('adm-zip');
const sharp = require('sharp');

const router = express.Router();

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
router.get('/', authenticate, async (req, res) => {
  try {
    const db = getDB();
    const {
      subject_id, subject, difficulty, type, exam_type, paper_type, year, search,
      page = 1, limit = 25,
    } = req.query;

    const limitNum = Math.max(1, Math.min(200, Number(limit) || 25));
    const pageNum = Math.max(1, Number(page) || 1);
    const offsetNum = (pageNum - 1) * limitNum;
    let where = 'q.is_active = TRUE';
    const params = [];

    if (subject_id) { where += ' AND q.subject_id = ?'; params.push(subject_id); }
    if (subject && subject !== 'All') { where += ' AND s.name = ?'; params.push(subject); }
    if (difficulty)  { where += ' AND q.difficulty = ?';  params.push(difficulty); }
    if (type)        { where += ' AND q.question_type = ?'; params.push(type); }
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
    const [questions] = await db.execute(
      `SELECT q.*, s.name as subject_name, u.full_name as created_by_name
       FROM questions q
       LEFT JOIN subjects s ON q.subject_id = s.id
       LEFT JOIN users u ON q.created_by = u.id
       WHERE ${where}
       ORDER BY (q.question_number IS NULL) ASC, q.question_number ASC, q.created_at DESC
       LIMIT ${limitNum} OFFSET ${offsetNum}`,
      params
    );

    const [[{ total }]] = await db.execute(
      `SELECT COUNT(*) as total FROM questions q LEFT JOIN subjects s ON q.subject_id = s.id WHERE ${where}`,
      params
    );

    res.json({ questions, total });
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

// POST /api/questions/clean-math-notation — one-time cleanup for questions
// already imported before the extraction pipeline started normalizing LaTeX
// markup ($x^2$, \frac{}{}, \circ) into plain text. Scans every active
// question, cleans question_text/options/explanation, and only writes back
// rows that actually changed. Safe to run repeatedly — already-clean rows
// are no-ops. Optionally scoped to one subject/exam_body via query params
// so it can be run narrowly (e.g. just the WAEC 1988 batch) instead of the
// whole bank at once.
router.post('/clean-math-notation', authenticate, authorize('superadmin', 'admin'), async (req, res) => {
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
    const pad = 3;
    const xMin = Math.max(0, box.x_min - pad);
    const yMin = Math.max(0, box.y_min - pad);
    const xMax = Math.min(100, box.x_max + pad);
    const yMax = Math.min(100, box.y_max + pad);
    if (xMax <= xMin || yMax <= yMin) return null;
    const left = Math.round((xMin / 100) * meta.width);
    const top = Math.round((yMin / 100) * meta.height);
    const width = Math.round(((xMax - xMin) / 100) * meta.width);
    const height = Math.round(((yMax - yMin) / 100) * meta.height);
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

          // Skip re-cropping if this row's media_url already resolves —
          // avoids unnecessary AI/crop work on rows that were never broken.
          if (match.media_url) {
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
      message: `Repaired ${repaired} diagram(s)`,
      repaired, already_fine: alreadyFine, no_diagram_needed: noDiagram,
      no_match: noMatch, pages_failed: pagesFailed,
      unmatched_sample: unmatched.slice(0, 10),
    });
  });
});

module.exports = router;
