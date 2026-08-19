// ── Exam Preparation Learning System: syllabus management ──────────────────
// Milestone A of the "Read by Topic" feature. CRUD for the 5-level hierarchy
// (Exam Body -> Examination -> Syllabus Subject -> Topic -> Subtopic) plus
// AI-drafted topic content that requires admin review before publishing —
// same staging shape as the question import pipeline, applied to learning
// content instead of questions.

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('../models/db');
const { authenticate, authorize } = require('../middleware/auth');
const { generateTopicContent } = require('../ai/questionGenerator');

const router = express.Router();

const ADMIN_ROLES = ['superadmin', 'admin'];

// ═══════════════════════════ EXAM BODIES ═══════════════════════════════════

router.get('/exam-bodies', authenticate, async (req, res) => {
  try {
    const db = getDB();
    const activeOnly = req.user.role === 'candidate';
    const [rows] = await db.execute(
      `SELECT * FROM exam_bodies ${activeOnly ? 'WHERE is_active = TRUE' : ''} ORDER BY display_order, name`
    );
    res.json({ exam_bodies: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/exam-bodies', authenticate, authorize(...ADMIN_ROLES), async (req, res) => {
  try {
    const db = getDB();
    const { name, code, description, display_order } = req.body;
    if (!name?.trim() || !code?.trim()) return res.status(400).json({ error: 'name and code are required' });
    const id = uuidv4();
    await db.execute(
      'INSERT INTO exam_bodies (id, name, code, description, display_order) VALUES (?, ?, ?, ?, ?)',
      [id, name.trim(), code.trim().toUpperCase(), description || null, display_order || 0]
    );
    res.status(201).json({ id, message: 'Exam body created' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: `Exam body code "${req.body.code}" already exists` });
    res.status(500).json({ error: err.message });
  }
});

router.put('/exam-bodies/:id', authenticate, authorize(...ADMIN_ROLES), async (req, res) => {
  try {
    const db = getDB();
    const { name, description, is_active, display_order } = req.body;
    await db.execute(
      'UPDATE exam_bodies SET name=COALESCE(?,name), description=?, is_active=COALESCE(?,is_active), display_order=COALESCE(?,display_order) WHERE id=?',
      [name || null, description ?? null, is_active ?? null, display_order ?? null, req.params.id]
    );
    res.json({ message: 'Exam body updated' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/exam-bodies/:id', authenticate, authorize(...ADMIN_ROLES), async (req, res) => {
  try {
    const db = getDB();
    await db.execute('DELETE FROM exam_bodies WHERE id=?', [req.params.id]);
    res.json({ message: 'Exam body deleted (and everything under it)' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════ EXAMINATIONS ══════════════════════════════════

router.get('/exam-bodies/:examBodyId/examinations', authenticate, async (req, res) => {
  try {
    const db = getDB();
    const activeOnly = req.user.role === 'candidate';
    const [rows] = await db.execute(
      `SELECT * FROM examinations WHERE exam_body_id=? ${activeOnly ? 'AND is_active = TRUE' : ''} ORDER BY display_order, name`,
      [req.params.examBodyId]
    );
    res.json({ examinations: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/exam-bodies/:examBodyId/examinations', authenticate, authorize(...ADMIN_ROLES), async (req, res) => {
  try {
    const db = getDB();
    const { name, code, description, display_order } = req.body;
    if (!name?.trim() || !code?.trim()) return res.status(400).json({ error: 'name and code are required' });
    const id = uuidv4();
    await db.execute(
      'INSERT INTO examinations (id, exam_body_id, name, code, description, display_order) VALUES (?, ?, ?, ?, ?, ?)',
      [id, req.params.examBodyId, name.trim(), code.trim(), description || null, display_order || 0]
    );
    res.status(201).json({ id, message: 'Examination created' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'That examination code already exists for this exam body' });
    res.status(500).json({ error: err.message });
  }
});

router.put('/examinations/:id', authenticate, authorize(...ADMIN_ROLES), async (req, res) => {
  try {
    const db = getDB();
    const { name, description, is_active, display_order } = req.body;
    await db.execute(
      'UPDATE examinations SET name=COALESCE(?,name), description=?, is_active=COALESCE(?,is_active), display_order=COALESCE(?,display_order) WHERE id=?',
      [name || null, description ?? null, is_active ?? null, display_order ?? null, req.params.id]
    );
    res.json({ message: 'Examination updated' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/examinations/:id', authenticate, authorize(...ADMIN_ROLES), async (req, res) => {
  try {
    const db = getDB();
    await db.execute('DELETE FROM examinations WHERE id=?', [req.params.id]);
    res.json({ message: 'Examination deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════ SYLLABUS SUBJECTS ═════════════════════════════

router.get('/examinations/:examinationId/subjects', authenticate, async (req, res) => {
  try {
    const db = getDB();
    const activeOnly = req.user.role === 'candidate';
    const [rows] = await db.execute(
      `SELECT ss.*, s.name as linked_subject_name FROM syllabus_subjects ss
       LEFT JOIN subjects s ON ss.linked_subject_id = s.id
       WHERE ss.examination_id=? ${activeOnly ? 'AND ss.is_active = TRUE' : ''} ORDER BY ss.display_order, ss.name`,
      [req.params.examinationId]
    );
    res.json({ subjects: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/examinations/:examinationId/subjects', authenticate, authorize(...ADMIN_ROLES), async (req, res) => {
  try {
    const db = getDB();
    const { name, code, description, linked_subject_id, display_order } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'name is required' });
    const id = uuidv4();
    await db.execute(
      'INSERT INTO syllabus_subjects (id, examination_id, linked_subject_id, name, code, description, display_order) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, req.params.examinationId, linked_subject_id || null, name.trim(), code || null, description || null, display_order || 0]
    );
    res.status(201).json({ id, message: 'Subject created' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/subjects/:id', authenticate, authorize(...ADMIN_ROLES), async (req, res) => {
  try {
    const db = getDB();
    const { name, description, linked_subject_id, is_active, display_order } = req.body;
    await db.execute(
      'UPDATE syllabus_subjects SET name=COALESCE(?,name), description=?, linked_subject_id=?, is_active=COALESCE(?,is_active), display_order=COALESCE(?,display_order) WHERE id=?',
      [name || null, description ?? null, linked_subject_id ?? null, is_active ?? null, display_order ?? null, req.params.id]
    );
    res.json({ message: 'Subject updated' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/subjects/:id', authenticate, authorize(...ADMIN_ROLES), async (req, res) => {
  try {
    const db = getDB();
    await db.execute('DELETE FROM syllabus_subjects WHERE id=?', [req.params.id]);
    res.json({ message: 'Subject deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════ TOPICS ════════════════════════════════════════

router.get('/subjects/:subjectId/topics', authenticate, async (req, res) => {
  try {
    const db = getDB();
    const activeOnly = req.user.role === 'candidate';
    const [rows] = await db.execute(
      `SELECT t.*, tc.status as content_status FROM syllabus_topics t
       LEFT JOIN topic_content tc ON tc.topic_id = t.id
       WHERE t.syllabus_subject_id=? ${activeOnly ? 'AND t.is_active = TRUE' : ''} ORDER BY t.display_order, t.name`,
      [req.params.subjectId]
    );
    res.json({ topics: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/subjects/:subjectId/topics', authenticate, authorize(...ADMIN_ROLES), async (req, res) => {
  try {
    const db = getDB();
    const { name, description, display_order } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'name is required' });
    const id = uuidv4();
    const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    await db.execute(
      'INSERT INTO syllabus_topics (id, syllabus_subject_id, name, slug, description, display_order) VALUES (?, ?, ?, ?, ?, ?)',
      [id, req.params.subjectId, name.trim(), slug, description || null, display_order || 0]
    );
    res.status(201).json({ id, message: 'Topic created' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/topics/:id', authenticate, authorize(...ADMIN_ROLES), async (req, res) => {
  try {
    const db = getDB();
    const { name, description, is_active, display_order } = req.body;
    await db.execute(
      'UPDATE syllabus_topics SET name=COALESCE(?,name), description=?, is_active=COALESCE(?,is_active), display_order=COALESCE(?,display_order) WHERE id=?',
      [name || null, description ?? null, is_active ?? null, display_order ?? null, req.params.id]
    );
    res.json({ message: 'Topic updated' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/topics/:id', authenticate, authorize(...ADMIN_ROLES), async (req, res) => {
  try {
    const db = getDB();
    await db.execute('DELETE FROM syllabus_topics WHERE id=?', [req.params.id]);
    res.json({ message: 'Topic deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET a single topic with its full breadcrumb (exam body/examination/subject
// names) — the topic learning page header needs all of this in one call.
router.get('/topics/:id', authenticate, async (req, res) => {
  try {
    const db = getDB();
    const [rows] = await db.execute(
      `SELECT t.*, ss.name as subject_name, ss.id as subject_id, ss.linked_subject_id,
              e.name as examination_name, e.id as examination_id,
              eb.name as exam_body_name, eb.id as exam_body_id, eb.code as exam_body_code
       FROM syllabus_topics t
       JOIN syllabus_subjects ss ON t.syllabus_subject_id = ss.id
       JOIN examinations e ON ss.examination_id = e.id
       JOIN exam_bodies eb ON e.exam_body_id = eb.id
       WHERE t.id=?`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Topic not found' });
    const [subtopics] = await db.execute('SELECT * FROM syllabus_subtopics WHERE topic_id=? ORDER BY display_order, name', [req.params.id]);
    res.json({ topic: rows[0], subtopics });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════ SUBTOPICS ═════════════════════════════════════

router.post('/topics/:topicId/subtopics', authenticate, authorize(...ADMIN_ROLES), async (req, res) => {
  try {
    const db = getDB();
    const { name, display_order } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'name is required' });
    const id = uuidv4();
    await db.execute(
      'INSERT INTO syllabus_subtopics (id, topic_id, name, display_order) VALUES (?, ?, ?, ?)',
      [id, req.params.topicId, name.trim(), display_order || 0]
    );
    res.status(201).json({ id, message: 'Subtopic created' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/subtopics/:id', authenticate, authorize(...ADMIN_ROLES), async (req, res) => {
  try {
    const db = getDB();
    await db.execute('DELETE FROM syllabus_subtopics WHERE id=?', [req.params.id]);
    res.json({ message: 'Subtopic deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════ TOPIC CONTENT (AI draft -> admin review) ═════

// GET content for a topic — students only ever get this via a route that
// filters to 'published' (added in Milestone B); this admin-facing route
// returns drafts too, for the review screen.
router.get('/topics/:topicId/content', authenticate, authorize(...ADMIN_ROLES), async (req, res) => {
  try {
    const db = getDB();
    const [rows] = await db.execute('SELECT * FROM topic_content WHERE topic_id=?', [req.params.topicId]);
    res.json({ content: rows[0] || null });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /topics/:topicId/content/generate — AI drafts the content. Always
// lands as status='draft', regardless of whether content already existed —
// an admin must explicitly publish (or re-publish after edits) below.
// Never overwrites already-published content silently.
router.post('/topics/:topicId/content/generate', authenticate, authorize(...ADMIN_ROLES), async (req, res) => {
  try {
    const db = getDB();
    const [topicRows] = await db.execute(
      `SELECT t.name as topic_name, ss.name as subject_name, e.name as examination_name, eb.name as exam_body_name
       FROM syllabus_topics t
       JOIN syllabus_subjects ss ON t.syllabus_subject_id = ss.id
       JOIN examinations e ON ss.examination_id = e.id
       JOIN exam_bodies eb ON e.exam_body_id = eb.id
       WHERE t.id=?`,
      [req.params.topicId]
    );
    const topic = topicRows[0];
    if (!topic) return res.status(404).json({ error: 'Topic not found' });

    const draft = await generateTopicContent({
      examBody: topic.exam_body_name,
      examination: topic.examination_name,
      subject: topic.subject_name,
      topic: topic.topic_name,
    });

    const [existing] = await db.execute('SELECT id, status FROM topic_content WHERE topic_id=?', [req.params.topicId]);
    if (existing[0] && existing[0].status === 'published') {
      return res.status(409).json({
        error: 'This topic already has published content. Generating a new draft would require explicit re-publish — use PUT /content to edit directly, or confirm_overwrite=true to regenerate a fresh draft without touching the live published version.',
      });
    }

    if (existing[0]) {
      await db.execute(
        `UPDATE topic_content SET learning_objectives=?, key_concepts=?, formulas=?, definitions=?,
         worked_examples=?, exam_tips=?, common_mistakes=?, status='draft', generated_by='ai',
         ai_generated_at=NOW() WHERE topic_id=?`,
        [draft.learning_objectives, draft.key_concepts, draft.formulas, draft.definitions,
         draft.worked_examples, draft.exam_tips, draft.common_mistakes, req.params.topicId]
      );
      res.json({ message: 'Draft regenerated', content_id: existing[0].id });
    } else {
      const id = uuidv4();
      await db.execute(
        `INSERT INTO topic_content
         (id, topic_id, learning_objectives, key_concepts, formulas, definitions,
          worked_examples, exam_tips, common_mistakes, status, generated_by, ai_generated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', 'ai', NOW())`,
        [id, req.params.topicId, draft.learning_objectives, draft.key_concepts, draft.formulas,
         draft.definitions, draft.worked_examples, draft.exam_tips, draft.common_mistakes]
      );
      res.status(201).json({ message: 'Draft generated', content_id: id });
    }
  } catch (err) {
    console.error('topic content generation error:', err.message);
    res.status(500).json({ error: 'AI content generation failed: ' + err.message });
  }
});

// PUT /topics/:topicId/content — admin edits (and optionally publishes)
router.put('/topics/:topicId/content', authenticate, authorize(...ADMIN_ROLES), async (req, res) => {
  try {
    const db = getDB();
    const {
      learning_objectives, key_concepts, formulas, definitions,
      worked_examples, exam_tips, common_mistakes, publish,
    } = req.body;

    const [existing] = await db.execute('SELECT id FROM topic_content WHERE topic_id=?', [req.params.topicId]);
    const status = publish ? 'published' : 'draft';
    const generatedBy = publish ? 'ai_then_admin' : undefined;

    if (existing[0]) {
      await db.execute(
        `UPDATE topic_content SET
         learning_objectives=COALESCE(?,learning_objectives), key_concepts=COALESCE(?,key_concepts),
         formulas=COALESCE(?,formulas), definitions=COALESCE(?,definitions),
         worked_examples=COALESCE(?,worked_examples), exam_tips=COALESCE(?,exam_tips),
         common_mistakes=COALESCE(?,common_mistakes),
         status=?, generated_by=COALESCE(?,generated_by),
         reviewed_by=?, reviewed_at=NOW()
         WHERE topic_id=?`,
        [learning_objectives, key_concepts, formulas, definitions, worked_examples, exam_tips,
         common_mistakes, status, generatedBy, req.user.id, req.params.topicId]
      );
    } else {
      // Admin writing content from scratch with no prior AI draft.
      if (!learning_objectives && !key_concepts) return res.status(400).json({ error: 'No existing content to edit — generate an AI draft first, or provide at least learning_objectives/key_concepts' });
      await db.execute(
        `INSERT INTO topic_content
         (id, topic_id, learning_objectives, key_concepts, formulas, definitions,
          worked_examples, exam_tips, common_mistakes, status, generated_by, reviewed_by, reviewed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'admin', ?, NOW())`,
        [uuidv4(), req.params.topicId, learning_objectives || null, key_concepts || null, formulas || null,
         definitions || null, worked_examples || null, exam_tips || null, common_mistakes || null,
         status, req.user.id]
      );
    }
    res.json({ message: publish ? 'Content published' : 'Draft saved' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /topics/:topicId/published-content — student-safe: only ever returns
// content that's actually been published, never a draft, regardless of role.
// This is the one AI-content boundary that matters most (section 20).
router.get('/topics/:topicId/published-content', authenticate, async (req, res) => {
  try {
    const db = getDB();
    const [rows] = await db.execute(
      "SELECT * FROM topic_content WHERE topic_id=? AND status='published'",
      [req.params.topicId]
    );
    res.json({ content: rows[0] || null });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════ STUDENT PROGRESS ══════════════════════════════

// GET /progress/subject/:subjectId — every topic in a subject with this
// student's progress against it (or a default not_started row if they've
// never touched it). Powers section 5's progress table.
router.get('/progress/subject/:subjectId', authenticate, authorize('candidate'), async (req, res) => {
  try {
    const db = getDB();
    const [rows] = await db.execute(
      `SELECT t.id as topic_id, t.name as topic_name, t.display_order,
              COALESCE(p.status, 'not_started') as status,
              COALESCE(p.progress_percent, 0) as progress_percent,
              p.practice_score, p.test_score, p.last_activity_at
       FROM syllabus_topics t
       LEFT JOIN student_topic_progress p ON p.topic_id = t.id AND p.student_id = ?
       WHERE t.syllabus_subject_id = ? AND t.is_active = TRUE
       ORDER BY t.display_order, t.name`,
      [req.user.id, req.params.subjectId]
    );
    res.json({ topics: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /progress/topic/:topicId — this student's progress on one topic
router.get('/progress/topic/:topicId', authenticate, authorize('candidate'), async (req, res) => {
  try {
    const db = getDB();
    const [rows] = await db.execute(
      'SELECT * FROM student_topic_progress WHERE student_id=? AND topic_id=?',
      [req.user.id, req.params.topicId]
    );
    res.json({ progress: rows[0] || { status: 'not_started', progress_percent: 0 } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /progress/topic/:topicId/start — called when a student opens "Read
// Topic". Only moves not_started -> in_progress; never downgrades a
// completed/needs_revision topic just because they reopened it to review.
router.post('/progress/topic/:topicId/start', authenticate, authorize('candidate'), async (req, res) => {
  try {
    const db = getDB();
    const [existing] = await db.execute('SELECT id, status FROM student_topic_progress WHERE student_id=? AND topic_id=?', [req.user.id, req.params.topicId]);
    if (existing[0]) {
      if (existing[0].status === 'not_started') {
        await db.execute("UPDATE student_topic_progress SET status='in_progress', progress_percent=GREATEST(progress_percent,10), last_activity_at=NOW() WHERE id=?", [existing[0].id]);
      } else {
        await db.execute('UPDATE student_topic_progress SET last_activity_at=NOW() WHERE id=?', [existing[0].id]);
      }
    } else {
      await db.execute(
        `INSERT INTO student_topic_progress (id, student_id, topic_id, status, progress_percent, last_activity_at)
         VALUES (?, ?, ?, 'in_progress', 10, NOW())`,
        [uuidv4(), req.user.id, req.params.topicId]
      );
    }
    res.json({ message: 'Progress updated' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /progress/topic/:topicId/complete — "Mark Topic as Completed"
router.post('/progress/topic/:topicId/complete', authenticate, authorize('candidate'), async (req, res) => {
  try {
    const db = getDB();
    const [existing] = await db.execute('SELECT id FROM student_topic_progress WHERE student_id=? AND topic_id=?', [req.user.id, req.params.topicId]);
    if (existing[0]) {
      await db.execute("UPDATE student_topic_progress SET status='completed', progress_percent=100, completed_at=NOW(), last_activity_at=NOW() WHERE id=?", [existing[0].id]);
    } else {
      await db.execute(
        `INSERT INTO student_topic_progress (id, student_id, topic_id, status, progress_percent, completed_at, last_activity_at)
         VALUES (?, ?, ?, 'completed', 100, NOW(), NOW())`,
        [uuidv4(), req.user.id, req.params.topicId]
      );
    }
    res.json({ message: 'Topic marked complete' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /continue-learning — the single most recently touched, not-yet-complete
// topic, with the full breadcrumb needed to render the resume card (section 19)
router.get('/continue-learning', authenticate, authorize('candidate'), async (req, res) => {
  try {
    const db = getDB();
    const [rows] = await db.execute(
      `SELECT p.topic_id, p.progress_percent, p.status, p.last_activity_at,
              t.name as topic_name, ss.id as subject_id, ss.name as subject_name,
              e.id as examination_id, e.name as examination_name,
              eb.id as exam_body_id, eb.name as exam_body_name
       FROM student_topic_progress p
       JOIN syllabus_topics t ON p.topic_id = t.id
       JOIN syllabus_subjects ss ON t.syllabus_subject_id = ss.id
       JOIN examinations e ON ss.examination_id = e.id
       JOIN exam_bodies eb ON e.exam_body_id = eb.id
       WHERE p.student_id = ? AND p.status = 'in_progress'
       ORDER BY p.last_activity_at DESC LIMIT 1`,
      [req.user.id]
    );
    res.json({ continue_learning: rows[0] || null });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
