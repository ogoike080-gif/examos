const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('../models/db');
const { authenticate, authorize } = require('../middleware/auth');
const { generateQuestionsWithAI } = require('../ai/questionGenerator');

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
      subject_id, subject, difficulty, type, exam_type, year, search,
      page = 1, limit = 25,
    } = req.query;

    const offset = (Number(page) - 1) * Number(limit);
    let where = 'q.is_active = TRUE';
    const params = [];

    if (subject_id) { where += ' AND q.subject_id = ?'; params.push(subject_id); }
    if (subject && subject !== 'All') { where += ' AND s.name = ?'; params.push(subject); }
    if (difficulty)  { where += ' AND q.difficulty = ?';  params.push(difficulty); }
    if (type)        { where += ' AND q.question_type = ?'; params.push(type); }
    if (exam_type && exam_type !== 'CUSTOM') { where += ' AND JSON_CONTAINS(q.exam_types, ?)'; params.push(JSON.stringify(exam_type)); }
    if (year && year !== 'All Years' && year !== 'All') { where += ' AND JSON_CONTAINS(q.tags, ?)'; params.push(JSON.stringify(String(year))); }
    if (search)      { where += ' AND q.question_text LIKE ?'; params.push(`%${search}%`); }

    const [questions] = await db.execute(
      `SELECT q.*, s.name as subject_name, u.full_name as created_by_name
       FROM questions q
       LEFT JOIN subjects s ON q.subject_id = s.id
       LEFT JOIN users u ON q.created_by = u.id
       WHERE ${where}
       ORDER BY q.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, Number(limit), Number(offset)]
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

module.exports = router;
