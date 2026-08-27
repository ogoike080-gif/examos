const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const archiver = require('archiver');
const AdmZip = require('adm-zip');
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('../models/db');
const { authenticate, authorize } = require('../middleware/auth');
const { extractQuestionsFromImage } = require('../ai/questionGenerator');

const router = express.Router();

const SOURCE_PAPERS_DIR = path.join(__dirname, '..', 'uploads', 'source-papers');
const DIAGRAMS_DIR = path.join(__dirname, '..', 'uploads', 'diagrams');

function safeFolderName(str) {
  return String(str || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_');
}

/**
 * Crops a diagram out of a full page photo using an AI-estimated percentage
 * bounding box, adds a small safety margin, and saves it as its own image.
 * Returns the public URL on success, or null if the box is missing/invalid/
 * the crop fails for any reason — callers should fall back to the whole page
 * image rather than losing the diagram entirely.
 */
async function cropDiagram(buffer, box) {
  if (!box || [box.x_min, box.y_min, box.x_max, box.y_max].some(v => typeof v !== 'number')) return null;
  try {
    const img = sharp(buffer);
    const meta = await img.metadata();
    if (!meta.width || !meta.height) return null;

    const pad = 3; // percentage points of margin so the crop isn't razor-tight
    const xMin = Math.max(0, box.x_min - pad);
    const yMin = Math.max(0, box.y_min - pad);
    const xMax = Math.min(100, box.x_max + pad);
    const yMax = Math.min(100, box.y_max + pad);
    if (xMax <= xMin || yMax <= yMin) return null;

    const left = Math.round((xMin / 100) * meta.width);
    const top = Math.round((yMin / 100) * meta.height);
    const width = Math.round(((xMax - xMin) / 100) * meta.width);
    const height = Math.round(((yMax - yMin) / 100) * meta.height);
    if (width < 20 || height < 20) return null; // suspiciously tiny — box was probably bad

    fs.mkdirSync(DIAGRAMS_DIR, { recursive: true });
    const filename = `${uuidv4()}.jpg`;
    await sharp(buffer)
      .extract({ left, top, width, height })
      .jpeg({ quality: 88 })
      .toFile(path.join(DIAGRAMS_DIR, filename));

    return `/uploads/diagrams/${filename}`;
  } catch (err) {
    console.error('diagram crop failed:', err.message);
    return null;
  }
}

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB — question paper photos can be large
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Only JPEG, PNG, or WEBP images are allowed'));
  },
});

// POST /api/import/image-extract  ← Upload a photo/scan of a question paper, AI-extract questions
router.post('/image-extract', authenticate, authorize('superadmin', 'admin', 'examiner'), (req, res) => {
  imageUpload.single('image')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Upload failed' });
    if (!req.file) return res.status(400).json({ error: 'No image file provided' });

    try {
      const result = await extractQuestionsFromImage({
        imageBase64: req.file.buffer.toString('base64'),
        mediaType: req.file.mimetype,
      });

      // Archive the original photo — organized by exam body + year, so admins can
      // pull the full source booklet back up later, zipped, regardless of what
      // the AI managed to transcribe. Also doubles as the image for any question
      // that references a diagram/table/graph on this page (see has_diagram below).
      // Best-effort: a save failure here never blocks the extraction the admin is waiting on.
      let archivedId = null;
      let pageImageUrl = null;
      try {
        const examBody = safeFolderName(req.body.exam_body);
        const year = safeFolderName(req.body.year);
        const dir = path.join(SOURCE_PAPERS_DIR, examBody, year);
        fs.mkdirSync(dir, { recursive: true });
        const ext = path.extname(req.file.originalname) || '.jpg';
        const storedName = `${uuidv4()}${ext}`;
        fs.writeFileSync(path.join(dir, storedName), req.file.buffer);
        pageImageUrl = `/uploads/source-papers/${examBody}/${year}/${storedName}`;

        const db = getDB();
        archivedId = uuidv4();
        await db.execute(
          `INSERT INTO source_papers (id, exam_body, year, subject_id, file_path, original_filename, uploaded_by)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [archivedId, req.body.exam_body || 'Unknown', req.body.year || 'Unknown',
           req.body.subject_id || null, `${examBody}/${year}/${storedName}`,
           req.file.originalname || null, req.user.id]
        );
      } catch (archiveErr) {
        console.error('source-paper archive error:', archiveErr.message);
      }

      const rawQuestions = (result.questions || []).filter(q => q.question_text?.trim());
      const questions = [];
      for (const q of rawQuestions) {
        let mediaUrl = null;
        if (q.has_diagram) {
          mediaUrl = await cropDiagram(req.file.buffer, q.diagram_box);
          if (!mediaUrl) mediaUrl = pageImageUrl; // crop failed or no box — fall back to the whole page
        }
        questions.push({
          question_text: q.question_text,
          question_type: q.question_type === 'essay' ? 'essay' : 'mcq',
          options: Array.isArray(q.options) ? q.options : [],
          correct_answers: (q.correct_answer_letter && Array.isArray(q.options))
            ? [q.options[q.correct_answer_letter.charCodeAt(0) - 65]].filter(Boolean)
            : [],
          explanation: q.explanation || '',
          difficulty: 'medium',
          marks: 1,
          tags: [],
          subject_hint: q.subject_hint || null,
          confidence: q.confidence || 'medium',
          media_url: mediaUrl,
        });
      }

      const isAnswerOnlyPage = questions.length === 0 && (result.answers || []).length > 0;

      res.json({
        questions,
        total: questions.length,
        notes: result.notes || '',
        archived: !!archivedId,
        warning: isAnswerOnlyPage
          ? "This page looks like an answers/solutions sheet, not questions — it has nothing to import on its own. Upload it together with the matching question pages as a .zip instead, so the answers can be matched to their questions automatically."
          : 'AI-extracted from an image — please review each question, answer, and explanation against the original page before importing. Answers and explanations are only filled in when your photo actually shows them printed; anything left blank needs to be marked/added by you.'
          + (questions.some(q => q.media_url) ? " Diagrams were auto-cropped from the source photo where possible — a few may still show the whole page if the crop could not be estimated confidently; fix those from Question Bank -> Edit." : ''),
      });
    } catch (aiErr) {
      console.error('image-extract error:', aiErr.message);
      res.status(500).json({ error: 'Could not read questions from that image. Try a clearer, well-lit photo with one page per image.' });
    }
  });
});

const zipUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 60 * 1024 * 1024 }, // a whole booklet of photos can be large
  fileFilter: (req, file, cb) => {
    const ok = file.mimetype === 'application/zip' || file.mimetype === 'application/x-zip-compressed'
      || file.originalname.toLowerCase().endsWith('.zip');
    if (ok) cb(null, true); else cb(new Error('Only .zip files are allowed here'));
  },
});

function normaliseText(t) {
  return String(t || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

// POST /api/import/zip-extract — upload a .zip of question-paper page photos for one
// exam body + year at once. Each photo is AI-read the same way single photos are,
// each gets archived individually, and questions that already exist in the bank
// (exact normalised text match) are automatically flagged as duplicates instead
// of being silently re-imported.
router.post('/zip-extract', authenticate, authorize('superadmin', 'admin', 'examiner'), (req, res) => {
  zipUpload.single('zip')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Upload failed' });
    if (!req.file) return res.status(400).json({ error: 'No zip file provided' });

    const examBody = req.body.exam_body || 'Unknown';
    const year = req.body.year || 'Unknown';
    const subjectId = req.body.subject_id || null;

    let entries;
    try {
      const zip = new AdmZip(req.file.buffer);
      entries = zip.getEntries().filter(e => {
        if (e.isDirectory) return false;
        const name = e.entryName.toLowerCase();
        if (name.includes('__macosx') || name.split('/').pop().startsWith('.')) return false;
        return /\.(jpe?g|png|webp)$/.test(name);
      });
    } catch (zipErr) {
      return res.status(400).json({ error: 'Could not read that zip file — make sure it\'s a valid .zip archive of photos' });
    }

    if (entries.length === 0) {
      return res.status(400).json({ error: 'No JPG/PNG/WEBP photos found inside that zip' });
    }
    if (entries.length > 60) {
      return res.status(400).json({ error: `That zip has ${entries.length} photos — please split into batches of 60 or fewer so each can be read carefully` });
    }

    const db = getDB();
    const [existingRows] = await db.execute('SELECT question_text FROM questions WHERE is_active = TRUE');
    const existingSet = new Set(existingRows.map(r => normaliseText(r.question_text)));

    const mimeFor = (name) => {
      if (name.endsWith('.png')) return 'image/png';
      if (name.endsWith('.webp')) return 'image/webp';
      return 'image/jpeg';
    };

    // ── PASS 1: read every photo, collect raw questions + raw answer/solution entries.
    // Nothing is finalized yet — a photo showing "Answers & Explanations" has no idea
    // which earlier photo its numbers belong to, so we hold everything until every
    // page has been read, then match by number in Pass 2 below.
    const rawQuestions = []; // { number, question_type, ...fields, source_photo }
    const rawAnswers = [];   // { number, correct_answer_letter, solution_text, source_photo }
    const perPhoto = [];
    const photoImageUrls = {}; // filename -> archived URL, for diagram-bearing questions

    for (const entry of entries) {
      const filename = entry.entryName.split('/').pop();
      try {
        const buffer = entry.getData();
        const result = await extractQuestionsFromImage({
          imageBase64: buffer.toString('base64'),
          mediaType: mimeFor(filename.toLowerCase()),
        });

        const pageQuestions = (result.questions || []).filter(q => q.question_text?.trim());
        for (const q of pageQuestions) {
          let diagramUrl = null;
          if (q.has_diagram) diagramUrl = await cropDiagram(buffer, q.diagram_box);
          rawQuestions.push({ ...q, source_photo: filename, diagram_url: diagramUrl });
        }

        const pageAnswers = (result.answers || []).filter(a => a.number !== undefined && a.number !== null);
        pageAnswers.forEach(a => rawAnswers.push({ ...a, source_photo: filename }));

        // Archive this page — best-effort, same as the single-photo flow.
        // Also doubles as the image for any question on this page with a diagram.
        try {
          const safeBody = safeFolderName(examBody);
          const safeYear = safeFolderName(year);
          const dir = path.join(SOURCE_PAPERS_DIR, safeBody, safeYear);
          fs.mkdirSync(dir, { recursive: true });
          const ext = path.extname(filename) || '.jpg';
          const storedName = `${uuidv4()}${ext}`;
          fs.writeFileSync(path.join(dir, storedName), buffer);
          photoImageUrls[filename] = `/uploads/source-papers/${safeBody}/${safeYear}/${storedName}`;
          await db.execute(
            `INSERT INTO source_papers (id, exam_body, year, subject_id, file_path, original_filename, uploaded_by)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [uuidv4(), examBody, year, subjectId, `${safeBody}/${safeYear}/${storedName}`, filename, req.user.id]
          );
        } catch (archiveErr) {
          console.error('zip source-paper archive error:', archiveErr.message);
        }

        perPhoto.push({
          filename,
          pageType: result.page_type || 'unknown',
          questionsFound: pageQuestions.length,
          answersFound: pageAnswers.length,
        });
      } catch (photoErr) {
        console.error(`zip-extract photo error (${filename}):`, photoErr.message);
        perPhoto.push({ filename, error: 'Could not be read — skipped' });
      }
    }

    // ── PASS 2: match answer/solution entries back to their question by number.
    // Objective (mcq) and theory (essay) questions are numbered in separate pools,
    // since a booklet's Theory Q1 and Objective Q1 are different questions that
    // happen to share a number — checked objective pool first since it's the far
    // more common case (WAEC-style 1–50), falling back to theory.
    const objectivePool = new Map(); // number -> question object
    const theoryPool = new Map();
    const unnumbered = [];

    rawQuestions.forEach(q => {
      const merged = {
        question_text: q.question_text,
        question_type: q.question_type === 'essay' ? 'essay' : 'mcq',
        options: Array.isArray(q.options) ? q.options : [],
        correct_answers: (q.correct_answer_letter && Array.isArray(q.options))
          ? [q.options[q.correct_answer_letter.charCodeAt(0) - 65]].filter(Boolean)
          : [],
        explanation: q.explanation || '',
        difficulty: 'medium',
        marks: 1,
        tags: [],
        subject_hint: q.subject_hint || null,
        confidence: q.confidence || 'medium',
        source_photo: q.source_photo,
        source_number: q.number ?? null,
        media_url: q.has_diagram ? (q.diagram_url || photoImageUrls[q.source_photo] || null) : null,
      };
      const pool = merged.question_type === 'essay' ? theoryPool : objectivePool;
      if (q.number !== undefined && q.number !== null && !pool.has(q.number)) {
        pool.set(q.number, merged);
      } else {
        unnumbered.push(merged);
      }
    });

    let answersMatched = 0;
    const unmatchedAnswers = [];
    for (const a of rawAnswers) {
      let target = objectivePool.get(a.number) || theoryPool.get(a.number);
      if (target && !target.explanation && !target.correct_answers.length) {
        if (a.solution_text) target.explanation = a.solution_text;
        if (a.correct_answer_letter && target.options.length) {
          const idx = a.correct_answer_letter.charCodeAt(0) - 65;
          if (target.options[idx]) target.correct_answers = [target.options[idx]];
        }
        answersMatched++;
      } else {
        unmatchedAnswers.push(a);
      }
    }

    const merged = [
      ...[...objectivePool.values()].sort((a, b) => (a.source_number ?? 0) - (b.source_number ?? 0)),
      ...[...theoryPool.values()].sort((a, b) => (a.source_number ?? 0) - (b.source_number ?? 0)),
      ...unnumbered,
    ];

    // Detect gaps in the objective numbering (e.g. paper has 1–50 but we only got 3–50) —
    // these are almost always questions the AI skipped, not questions that don't exist.
    const objNumbers = [...objectivePool.keys()].sort((a, b) => a - b);
    const numberGaps = [];
    if (objNumbers.length > 1) {
      for (let n = objNumbers[0]; n < objNumbers[objNumbers.length - 1]; n++) {
        if (!objectivePool.has(n)) numberGaps.push(n);
      }
      // Also flag if numbering doesn't start at 1 — likely missed the first item(s)
      if (objNumbers[0] > 1) {
        for (let n = 1; n < objNumbers[0]; n++) numberGaps.unshift(n);
      }
    }

    // ── PASS 3: dedupe against the existing question bank and within this batch
    const allQuestions = [];
    const seenThisBatch = new Set();
    let duplicatesSkipped = 0;
    const perPhotoKept = {};

    for (const q of merged) {
      const norm = normaliseText(q.question_text);
      if (existingSet.has(norm) || seenThisBatch.has(norm)) {
        duplicatesSkipped++;
        continue;
      }
      seenThisBatch.add(norm);
      allQuestions.push(q);
      perPhotoKept[q.source_photo] = (perPhotoKept[q.source_photo] || 0) + 1;
    }

    perPhoto.forEach(p => { if (!p.error) p.kept = perPhotoKept[p.filename] || 0; });

    res.json({
      questions: allQuestions,
      total: allQuestions.length,
      duplicatesSkipped,
      answersMatched,
      unmatchedAnswers: unmatchedAnswers.length,
      numberGaps,
      perPhoto,
      warning: 'AI-extracted from a batch of photos — please review each question, answer, and explanation before importing. Duplicates already in your question bank were automatically skipped; questions repeated across two pages in this same zip were also collapsed to one.'
        + (unmatchedAnswers.length ? ` ${unmatchedAnswers.length} answer/solution entries couldn't be matched to a question by number — check the "unmatched answers" note and add those manually if needed.` : '')
        + (numberGaps.length ? ` ⚠ Question number${numberGaps.length !== 1 ? 's' : ''} ${numberGaps.slice(0, 10).join(', ')}${numberGaps.length > 10 ? '…' : ''} appear to be missing from the objective section — likely skipped during reading, not genuinely absent from the paper. Check the original photo and add them manually if needed.` : '')
        + (allQuestions.some(q => q.media_url) ? " Diagrams were auto-cropped from the source photo where possible — a few may still show the whole page if the crop could not be estimated confidently; fix those from Question Bank -> Edit." : ''),
    });
  });
});

// GET /api/import/source-papers  ← list archived photo groups (by exam body + year), or one group's photos
router.get('/source-papers', authenticate, authorize('superadmin', 'admin', 'examiner'), async (req, res) => {
  try {
    const db = getDB();
    const { exam_body, year } = req.query;

    if (exam_body && year) {
      const [rows] = await db.execute(
        `SELECT sp.id, sp.file_path, sp.original_filename, sp.created_at, s.name as subject_name
         FROM source_papers sp LEFT JOIN subjects s ON sp.subject_id = s.id
         WHERE sp.exam_body = ? AND sp.year = ? ORDER BY sp.created_at DESC`,
        [exam_body, year]
      );
      return res.json({ papers: rows.map(r => ({ ...r, url: `/uploads/source-papers/${r.file_path}` })) });
    }

    const [groups] = await db.execute(
      `SELECT exam_body, year, COUNT(*) as count, MAX(created_at) as last_upload
       FROM source_papers GROUP BY exam_body, year ORDER BY exam_body, year DESC`
    );
    res.json({ groups });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/import/source-papers/zip?exam_body=WAEC&year=2019  ← download all photos for one group as a zip
router.get('/source-papers/zip', authenticate, authorize('superadmin', 'admin', 'examiner'), async (req, res) => {
  try {
    const { exam_body, year } = req.query;
    if (!exam_body || !year) return res.status(400).json({ error: 'exam_body and year are required' });

    const db = getDB();
    const [rows] = await db.execute(
      'SELECT file_path, original_filename FROM source_papers WHERE exam_body=? AND year=?',
      [exam_body, year]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'No archived photos found for that exam body and year' });

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${safeFolderName(exam_body)}-${safeFolderName(year)}-source-papers.zip"`);

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', err => { throw err; });
    archive.pipe(res);

    rows.forEach((r, i) => {
      const fullPath = path.join(SOURCE_PAPERS_DIR, r.file_path);
      if (fs.existsSync(fullPath)) {
        archive.file(fullPath, { name: r.original_filename || `page-${i + 1}${path.extname(r.file_path)}` });
      }
    });

    await archive.finalize();
  } catch (err) {
    console.error('source-papers zip error:', err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

// DELETE /api/import/source-papers/:id  ← remove one archived photo
router.delete('/source-papers/:id', authenticate, authorize('superadmin', 'admin'), async (req, res) => {
  try {
    const db = getDB();
    const [rows] = await db.execute('SELECT file_path FROM source_papers WHERE id=?', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    const fullPath = path.join(SOURCE_PAPERS_DIR, rows[0].file_path);
    fs.unlink(fullPath, () => {}); // best-effort, don't block on filesystem errors
    await db.execute('DELETE FROM source_papers WHERE id=?', [req.params.id]);
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/import/template  ← Download CSV template
// Fixed: proper headers so browser opens as Excel/CSV correctly
router.get('/template', authenticate, (req, res) => {
  const rows = [
    // Header row
    'question_text,option_a,option_b,option_c,option_d,correct_answer,explanation,difficulty,marks,tags,year,subject_code,image_url',
    // Example row 1
    '"If 2x + 3 = 11, find the value of x","x = 2","x = 3","x = 4","x = 5","C","2x = 11 - 3 = 8 therefore x = 4","easy","1","WAEC;Algebra","2023","MTH",""',
    // Example row 2
    '"What is the chemical symbol for Gold?","Ag","Au","Fe","Cu","B","Gold symbol is Au from Latin Aurum","easy","1","WAEC;Periodic Table","2023","CHM",""',
    // Example row 3
    '"A trader buys 50 items for N2500 and sells each for N60. What is the percentage profit?","16.7% profit","20% profit","20% loss","16.7% loss","A","Total revenue = 50 x 60 = 3000. Profit = 500. % = 500/3000 x 100 = 16.7%","medium","2","WAEC;Profit and Loss","2023","MTH",""',
  ];

  const csv = rows.join('\r\n');

  // These headers make the browser download it as a proper CSV file
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="examos-questions-template.csv"');
  res.setHeader('Content-Length', Buffer.byteLength(csv, 'utf8'));
  res.setHeader('Cache-Control', 'no-cache');

  // Add UTF-8 BOM so Excel opens it correctly without garbled characters
  res.send('\uFEFF' + csv);
});

// POST /api/import/csv-parse  ← Parse CSV text, return preview JSON
router.post('/csv-parse', authenticate, authorize('superadmin', 'admin', 'examiner'), async (req, res) => {
  try {
    const { csv_text } = req.body;
    if (!csv_text) return res.status(400).json({ error: 'csv_text is required' });

    const lines = csv_text.trim().split(/\r?\n/);
    if (lines.length < 2) {
      return res.status(400).json({ error: 'CSV must have a header row and at least 1 data row' });
    }

    // Parse header
    const headers = parseCSVLine(lines[0]).map(h => h.toLowerCase().trim());
    const questions = [];
    const errors = [];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      try {
        const cols = parseCSVLine(line);
        const row = {};
        headers.forEach((h, idx) => { row[h] = (cols[idx] || '').trim(); });

        if (!row.question_text) {
          errors.push({ row: i + 1, error: 'Missing question_text' });
          continue;
        }

        const options = [row.option_a, row.option_b, row.option_c, row.option_d].filter(Boolean);
        const correctRaw = (row.correct_answer || '').trim().toUpperCase();

        // Support A/B/C/D letter OR full text
        let correctAnswers = [];
        if (['A','B','C','D','E'].includes(correctRaw)) {
          const idx = correctRaw.charCodeAt(0) - 65;
          if (options[idx]) correctAnswers = [options[idx]];
        } else if (correctRaw) {
          correctAnswers = [row.correct_answer.trim()];
        }

        questions.push({
          question_text: row.question_text,
          question_type: 'mcq',
          options,
          correct_answers: correctAnswers,
          explanation: row.explanation || '',
          difficulty: ['easy','medium','hard'].includes(row.difficulty) ? row.difficulty : 'medium',
          marks: parseFloat(row.marks) || 1,
          tags: row.tags ? row.tags.split(';').map(t => t.trim()).filter(Boolean) : [],
          year: row.year || null,
          subject_code: (row.subject_code || '').toUpperCase(),
          media_url: row.image_url || row.media_url || null,
        });
      } catch (err) {
        errors.push({ row: i + 1, error: err.message });
      }
    }

    res.json({ questions, errors, total: questions.length });
  } catch (err) {
    console.error('csv-parse error:', err.message);
    res.status(500).json({ error: 'CSV parsing failed: ' + err.message });
  }
});

// POST /api/import/questions  ← Save imported questions to database
router.post('/questions', authenticate, authorize('superadmin', 'admin', 'examiner'), async (req, res) => {
  try {
    const db = getDB();
    const { questions, exam_body, year, subject_id } = req.body;

    if (!Array.isArray(questions) || questions.length === 0) {
      return res.status(400).json({ error: 'Provide a non-empty questions array' });
    }
    if (questions.length > 1000) {
      return res.status(400).json({ error: 'Maximum 1000 questions per import batch' });
    }

    // Build subject code -> id lookup
    const [subjects] = await db.execute('SELECT id, code FROM subjects');
    const subjectMap = {};
    subjects.forEach(s => { subjectMap[s.code.toUpperCase()] = s.id; });

    const results = { success: 0, failed: 0, errors: [] };

    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      try {
        if (!q.question_text?.trim()) {
          results.failed++;
          results.errors.push({ row: i + 1, error: 'Missing question_text' });
          continue;
        }

        // Resolve subject
        let resolvedSubjectId = subject_id || q.subject_id || null;
        if (!resolvedSubjectId && q.subject_code) {
          resolvedSubjectId = subjectMap[q.subject_code.toUpperCase()] || null;
        }

        // Build tags
        const tags = Array.isArray(q.tags) ? [...q.tags] : [];
        if (exam_body && !tags.includes(exam_body)) tags.push(exam_body);
        const qYear = q.year || year;
        if (qYear && !tags.includes(String(qYear))) tags.push(String(qYear));

        const examTypes = Array.isArray(q.exam_types) ? q.exam_types
          : exam_body ? [exam_body] : [];

        // Persist the original printed question number and exam metadata so
        // students see questions in the paper's actual order, not insertion
        // order. Previously this was only shown in the preview table and
        // discarded on save — the root cause of the ordering issue.
        const questionNumber = (q.source_number ?? q.question_number ?? null);
        const paperType = q.question_type === 'essay' ? 'theory' : 'objective';

        await db.execute(
          `INSERT INTO questions
           (id, subject_id, question_text, question_type, options, correct_answers,
            explanation, difficulty, marks, tags, exam_types, media_url, created_by,
            exam_body, paper_type, question_number)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            uuidv4(),
            resolvedSubjectId,
            q.question_text.trim(),
            q.question_type || 'mcq',
            JSON.stringify(Array.isArray(q.options) ? q.options : []),
            JSON.stringify(Array.isArray(q.correct_answers) ? q.correct_answers : []),
            q.explanation || null,
            ['easy','medium','hard'].includes(q.difficulty) ? q.difficulty : 'medium',
            parseFloat(q.marks) || 1,
            JSON.stringify(tags),
            JSON.stringify(examTypes),
            q.media_url || q.image_url || null,
            req.user.id,
            exam_body || null,
            paperType,
            questionNumber,
          ]
        );
        results.success++;
      } catch (err) {
        results.failed++;
        results.errors.push({
          row: i + 1,
          error: err.message,
          question: q.question_text?.slice(0, 60),
        });
      }
    }

    res.json({
      message: `Import complete: ${results.success} saved, ${results.failed} failed`,
      ...results,
    });
  } catch (err) {
    console.error('import error:', err.message);
    res.status(500).json({ error: 'Import failed: ' + err.message });
  }
});

// Helper: parse a single CSV line respecting quoted fields
function parseCSVLine(line) {
  const cols = [];
  let inQuote = false;
  let cur = '';

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuote && line[i + 1] === '"') {
        // Escaped quote inside quoted field
        cur += '"';
        i++;
      } else {
        inQuote = !inQuote;
      }
    } else if (ch === ',' && !inQuote) {
      cols.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  cols.push(cur);
  return cols;
}

module.exports = router;
