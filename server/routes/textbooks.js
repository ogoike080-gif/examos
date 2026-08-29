// ── Textbook Library ─────────────────────────────────────────────────────
// Milestone C of the exam-preparation learning system. Admin/teacher upload
// of learning materials, organized by chapter, with chapters mapped to
// syllabus topics so a student's "Recommended Reading" link goes straight to
// the relevant section instead of the whole book (spec sections 8-10).

const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('../models/db');
const { authenticate, authorize } = require('../middleware/auth');

const router = express.Router();
const ADMIN_ROLES = ['superadmin', 'admin', 'examiner']; // teachers included, per spec section 8

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads', 'textbooks');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const EXT_TO_TYPE = {
  '.pdf': 'pdf', '.docx': 'docx', '.pptx': 'pptx', '.ppt': 'pptx', '.txt': 'txt',
  '.jpg': 'image', '.jpeg': 'image', '.png': 'image', '.webp': 'image',
};

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => cb(null, `${uuidv4()}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB — textbooks are bigger than question-import photos
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (EXT_TO_TYPE[ext]) cb(null, true);
    else cb(new Error('Supported formats: PDF, DOCX, PPTX, TXT, JPG, PNG, WEBP'));
  },
});

// POST /api/textbooks — upload, with automatic text extraction for PDF/DOCX
router.post('/', authenticate, authorize(...ADMIN_ROLES), (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Upload failed' });
    if (!req.file) return res.status(400).json({ error: 'No file provided' });

    const { title, author, description, exam_body_id, examination_id, syllabus_subject_id } = req.body;
    if (!title?.trim()) return res.status(400).json({ error: 'title is required' });

    const ext = path.extname(req.file.originalname).toLowerCase();
    const fileType = EXT_TO_TYPE[ext];
    const db = getDB();
    const id = uuidv4();
    const needsExtraction = fileType === 'pdf' || fileType === 'docx';

    await db.execute(
      `INSERT INTO textbooks
       (id, title, author, description, file_type, file_path, file_size_bytes,
        extraction_status, exam_body_id, examination_id, syllabus_subject_id, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, title.trim(), author || null, description || null, fileType, req.file.filename,
        req.file.size, needsExtraction ? 'pending' : 'not_applicable',
        exam_body_id || null, examination_id || null, syllabus_subject_id || null, req.user.id,
      ]
    );

    // Extraction happens after responding — a textbook can be 50+ pages and
    // there's no reason to make the admin wait for it before seeing the
    // upload succeed. The admin UI polls extraction_status.
    res.status(201).json({ id, message: 'Textbook uploaded', extraction_status: needsExtraction ? 'pending' : 'not_applicable' });

    if (needsExtraction) {
      extractText(id, path.join(UPLOAD_DIR, req.file.filename), fileType).catch(e => console.error('textbook extraction error:', e.message));
    }
  });
});

async function extractText(textbookId, filePath, fileType) {
  const db = getDB();
  try {
    let text = '', pageCount = null;
    if (fileType === 'pdf') {
      const pdfParse = require('pdf-parse');
      const data = await pdfParse(fs.readFileSync(filePath));
      text = data.text;
      pageCount = data.numpages;
    } else if (fileType === 'docx') {
      const mammoth = require('mammoth');
      const result = await mammoth.extractRawText({ path: filePath });
      text = result.value;
    }
    // Cap what we store — this is for search/preview, not a full mirror of
    // the book, and LONGTEXT still has practical limits worth respecting.
    const capped = text.slice(0, 2_000_000);
    await db.execute(
      "UPDATE textbooks SET extracted_text=?, page_count=?, extraction_status='done' WHERE id=?",
      [capped, pageCount, textbookId]
    );
  } catch (err) {
    console.error(`textbook text extraction failed (${textbookId}):`, err.message);
    await db.execute("UPDATE textbooks SET extraction_status='failed' WHERE id=?", [textbookId]).catch(() => {});
  }
}

// GET /api/textbooks — list (filterable by subject, for the admin library view)
router.get('/', authenticate, authorize(...ADMIN_ROLES), async (req, res) => {
  try {
    const db = getDB();
    const { syllabus_subject_id } = req.query;
    let where = '1=1'; const params = [];
    if (syllabus_subject_id) { where += ' AND t.syllabus_subject_id=?'; params.push(syllabus_subject_id); }
    const [rows] = await db.execute(
      `SELECT t.*, ss.name as subject_name, eb.name as exam_body_name, u.full_name as uploaded_by_name,
       (SELECT COUNT(*) FROM textbook_chapters c WHERE c.textbook_id = t.id) as chapter_count
       FROM textbooks t
       LEFT JOIN syllabus_subjects ss ON t.syllabus_subject_id = ss.id
       LEFT JOIN exam_bodies eb ON t.exam_body_id = eb.id
       LEFT JOIN users u ON t.uploaded_by = u.id
       WHERE ${where} ORDER BY t.created_at DESC`,
      params
    );
    // Don't ship the (potentially huge) extracted_text blob in the list view.
    res.json({ textbooks: rows.map(({ extracted_text, ...r }) => r) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', authenticate, authorize(...ADMIN_ROLES), async (req, res) => {
  try {
    const db = getDB();
    const [rows] = await db.execute('SELECT * FROM textbooks WHERE id=?', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Textbook not found' });
    const { extracted_text, ...textbook } = rows[0];
    const [chapters] = await db.execute(
      `SELECT c.*, GROUP_CONCAT(tl.topic_id) as linked_topic_ids
       FROM textbook_chapters c LEFT JOIN textbook_topic_links tl ON tl.chapter_id = c.id
       WHERE c.textbook_id=? GROUP BY c.id ORDER BY c.display_order, c.start_page`,
      [req.params.id]
    );
    res.json({
      textbook,
      has_extracted_text: !!extracted_text,
      chapters: chapters.map(c => ({ ...c, linked_topic_ids: c.linked_topic_ids ? c.linked_topic_ids.split(',') : [] })),
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', authenticate, authorize(...ADMIN_ROLES), async (req, res) => {
  try {
    const db = getDB();
    const [rows] = await db.execute('SELECT file_path FROM textbooks WHERE id=?', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Textbook not found' });
    await db.execute('DELETE FROM textbooks WHERE id=?', [req.params.id]);
    const filePath = path.join(UPLOAD_DIR, rows[0].file_path);
    if (fs.existsSync(filePath)) fs.unlink(filePath, () => {});
    res.json({ message: 'Textbook deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════ CHAPTERS ══════════════════════════════════════

router.post('/:id/chapters', authenticate, authorize(...ADMIN_ROLES), async (req, res) => {
  try {
    const db = getDB();
    const { title, start_page, end_page, display_order } = req.body;
    if (!title?.trim()) return res.status(400).json({ error: 'title is required' });
    const id = uuidv4();
    await db.execute(
      'INSERT INTO textbook_chapters (id, textbook_id, title, start_page, end_page, display_order) VALUES (?, ?, ?, ?, ?, ?)',
      [id, req.params.id, title.trim(), start_page || null, end_page || null, display_order || 0]
    );
    res.status(201).json({ id, message: 'Chapter added' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/chapters/:chapterId', authenticate, authorize(...ADMIN_ROLES), async (req, res) => {
  try {
    const db = getDB();
    const { title, start_page, end_page, display_order } = req.body;
    await db.execute(
      'UPDATE textbook_chapters SET title=COALESCE(?,title), start_page=?, end_page=?, display_order=COALESCE(?,display_order) WHERE id=?',
      [title || null, start_page ?? null, end_page ?? null, display_order ?? null, req.params.chapterId]
    );
    res.json({ message: 'Chapter updated' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/chapters/:chapterId', authenticate, authorize(...ADMIN_ROLES), async (req, res) => {
  try {
    const db = getDB();
    await db.execute('DELETE FROM textbook_chapters WHERE id=?', [req.params.chapterId]);
    res.json({ message: 'Chapter deleted' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /chapters/:chapterId/topics — set the full list of linked topics at once
// (simpler for a multi-select UI than individual link/unlink calls)
router.put('/chapters/:chapterId/topics', authenticate, authorize(...ADMIN_ROLES), async (req, res) => {
  try {
    const db = getDB();
    const { topic_ids } = req.body;
    if (!Array.isArray(topic_ids)) return res.status(400).json({ error: 'topic_ids must be an array' });
    await db.execute('DELETE FROM textbook_topic_links WHERE chapter_id=?', [req.params.chapterId]);
    for (const topicId of topic_ids) {
      await db.execute(
        'INSERT INTO textbook_topic_links (id, chapter_id, topic_id) VALUES (?, ?, ?)',
        [uuidv4(), req.params.chapterId, topicId]
      );
    }
    res.json({ message: `Linked to ${topic_ids.length} topic(s)` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════ STUDENT-FACING ════════════════════════════════

// GET /api/textbooks/topic/:topicId/reading — "Recommended Reading" block.
// Returns every chapter mapped to this topic, with enough info to build the
// direct link (file + page anchor) without sending the whole book.
router.get('/topic/:topicId/reading', authenticate, async (req, res) => {
  try {
    const db = getDB();
    const [rows] = await db.execute(
      `SELECT c.id as chapter_id, c.title as chapter_title, c.start_page,
              t.id as textbook_id, t.title as textbook_title, t.author, t.file_type, t.file_path
       FROM textbook_topic_links tl
       JOIN textbook_chapters c ON tl.chapter_id = c.id
       JOIN textbooks t ON c.textbook_id = t.id
       WHERE tl.topic_id = ?
       ORDER BY t.title, c.display_order`,
      [req.params.topicId]
    );
    const reading = rows.map(r => ({
      chapter_id: r.chapter_id,
      chapter_title: r.chapter_title,
      textbook_title: r.textbook_title,
      author: r.author,
      file_type: r.file_type,
      // #page=N is honored by browser-native PDF viewers; for non-PDF types
      // this just opens the file and the student navigates manually.
      url: `/uploads/textbooks/${r.file_path}${r.file_type === 'pdf' && r.start_page ? `#page=${r.start_page}` : ''}`,
    }));
    res.json({ reading });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
