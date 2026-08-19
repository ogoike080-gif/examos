// ── Import Pipeline v2: batch-based staging routes ──────────────────────────
//
// This is a NEW, PARALLEL set of endpoints alongside the existing
// /api/import/zip-extract and /api/import/image-extract routes in import.js.
// Nothing in import.js is modified — those routes keep working exactly as
// they do today, and the current Import page keeps using them unchanged.
//
// This file reuses the same proven Pass 1 (read) / Pass 2 (answer matching) /
// Pass 3 (dedupe) logic from zip-extract, but instead of returning ephemeral
// JSON straight to the browser, it writes every result into `staged_questions`
// under an `import_batches` row — so a closed tab doesn't lose the work, and
// nothing reaches the live `questions` table until explicitly published from
// review. It also adds:
//   PASS 4 — real confidence scoring (see services/confidenceScoring.js)
//   PASS 5 — a focused second AI opinion for anything that scores below 75
//
// Mounted in index.js at /api/import/batches (separate from the existing
// /api/import mount) — see the one-line addition needed there.

const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const AdmZip = require('adm-zip');
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('../models/db');
const { authenticate, authorize } = require('../middleware/auth');
const { extractQuestionsFromImage, reverifyLowConfidenceQuestion } = require('../ai/questionGenerator');
const { computeConfidence } = require('../services/confidenceScoring');

const router = express.Router();

const SOURCE_PAPERS_DIR = path.join(__dirname, '..', 'uploads', 'source-papers');
const DIAGRAMS_DIR = path.join(__dirname, '..', 'uploads', 'diagrams');

// Duplicated from import.js deliberately rather than refactored out — see
// Milestone 3 note: extracting shared helpers into their own module touches
// the already-working import.js file, which we're avoiding this milestone.
// Small, stable, pure functions; low risk in staying duplicated for now.
function safeFolderName(str) {
  return String(str || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_');
}

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

const zipUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 60 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = file.mimetype === 'application/zip' || file.mimetype === 'application/x-zip-compressed'
      || file.originalname.toLowerCase().endsWith('.zip');
    if (ok) cb(null, true); else cb(new Error('Only .zip files are allowed here'));
  },
});

// ── POST /api/import/batches/zip ────────────────────────────────────────────
// Create a batch from a zip of page photos, run the full pipeline, and stage
// every resulting question. Synchronous, same as the existing zip-extract —
// a future milestone can move this to a background job if batch sizes grow,
// but the per-page failure isolation below already keeps one bad photo from
// taking down the rest.
router.post('/zip', authenticate, authorize('superadmin', 'admin', 'examiner'), (req, res) => {
  zipUpload.single('zip')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message || 'Upload failed' });
    if (!req.file) return res.status(400).json({ error: 'No zip file provided' });

    const examBody = req.body.exam_body || 'Unknown';
    const year = req.body.year || 'Unknown';
    const subjectId = req.body.subject_id || null;
    const paperType = ['objective', 'theory', 'essay', 'practical', 'combined'].includes(req.body.paper_type)
      ? req.body.paper_type : 'objective';
    const expectedCount = req.body.expected_count ? Number(req.body.expected_count) : null;

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
    if (entries.length === 0) return res.status(400).json({ error: 'No JPG/PNG/WEBP photos found inside that zip' });
    if (entries.length > 60) {
      return res.status(400).json({ error: `That zip has ${entries.length} photos — please split into batches of 60 or fewer` });
    }

    const db = getDB();
    const batchId = uuidv4();
    await db.execute(
      `INSERT INTO import_batches
       (id, exam_body, year, subject_id, paper_type, source_type, original_filename,
        expected_count, pages_total, status, created_by)
       VALUES (?, ?, ?, ?, ?, 'zip', ?, ?, ?, 'processing', ?)`,
      [batchId, examBody, year, subjectId, paperType, req.file.originalname || null,
       expectedCount, entries.length, req.user.id]
    );

    try {
      const [existingRows] = await db.execute('SELECT question_text FROM questions WHERE is_active = TRUE');
      const existingSet = new Set(existingRows.map(r => normaliseText(r.question_text)));

      const mimeFor = (name) => {
        if (name.endsWith('.png')) return 'image/png';
        if (name.endsWith('.webp')) return 'image/webp';
        return 'image/jpeg';
      };

      // ── PASS 1: read every photo ──
      const rawQuestions = [];
      const rawAnswers = [];
      let pagesProcessed = 0, pagesFailed = 0;
      const photoImageUrls = {};
      const photoBuffers = {}; // kept in memory for Pass 5 re-verification below

      for (const entry of entries) {
        const filename = entry.entryName.split('/').pop();
        try {
          const buffer = entry.getData();
          photoBuffers[filename] = buffer;
          const result = await extractQuestionsFromImage({
            imageBase64: buffer.toString('base64'),
            mediaType: mimeFor(filename.toLowerCase()),
          });

          const pageQuestions = (result.questions || []).filter(q => q.question_text?.trim());
          for (const q of pageQuestions) {
            let diagramUrl = null;
            if (q.has_diagram) diagramUrl = await cropDiagram(buffer, q.diagram_box);
            rawQuestions.push({ ...q, source_photo: filename, diagram_url: diagramUrl, diagram_crop_failed: !!q.has_diagram && !diagramUrl });
          }
          const pageAnswers = (result.answers || []).filter(a => a.number !== undefined && a.number !== null);
          pageAnswers.forEach(a => rawAnswers.push({ ...a, source_photo: filename }));

          try {
            const safeBody = safeFolderName(examBody);
            const safeYear = safeFolderName(year);
            const dir = path.join(SOURCE_PAPERS_DIR, safeBody, safeYear);
            fs.mkdirSync(dir, { recursive: true });
            const ext = path.extname(filename) || '.jpg';
            const storedName = `${uuidv4()}${ext}`;
            fs.writeFileSync(path.join(dir, storedName), buffer);
            const sourcePaperId = uuidv4();
            photoImageUrls[filename] = { url: `/uploads/source-papers/${safeBody}/${safeYear}/${storedName}`, id: sourcePaperId };
            await db.execute(
              `INSERT INTO source_papers (id, exam_body, year, subject_id, file_path, original_filename, uploaded_by)
               VALUES (?, ?, ?, ?, ?, ?, ?)`,
              [sourcePaperId, examBody, year, subjectId, `${safeBody}/${safeYear}/${storedName}`, filename, req.user.id]
            );
          } catch (archiveErr) {
            console.error('batch source-paper archive error:', archiveErr.message);
          }
          pagesProcessed++;
        } catch (photoErr) {
          console.error(`batch zip photo error (${filename}):`, photoErr.message);
          pagesFailed++;
        }
      }

      // ── PASS 2: match answers to questions by number, detecting conflicts ──
      const objectivePool = new Map();
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
          confidence: q.confidence || 'medium',
          source_photo: q.source_photo,
          source_number: q.number ?? null,
          media_url: q.has_diagram ? (q.diagram_url || (photoImageUrls[q.source_photo] || {}).url || null) : null,
          diagram_crop_failed: !!q.diagram_crop_failed,
          answer_from_key_page: false,
          answer_confirmed_twice: false,
          answer_conflict: false,
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
        const target = objectivePool.get(a.number) || theoryPool.get(a.number);
        if (!target) { unmatchedAnswers.push(a); continue; }

        const candidateAnswer = (a.correct_answer_letter && target.options.length)
          ? target.options[a.correct_answer_letter.charCodeAt(0) - 65]
          : null;

        if (!target.explanation && !target.correct_answers.length) {
          if (a.solution_text) target.explanation = a.solution_text;
          if (candidateAnswer) target.correct_answers = [candidateAnswer];
          target.answer_from_key_page = true;
          answersMatched++;
        } else if (candidateAnswer) {
          // Question already had an answer (own page or an earlier key entry) —
          // this is a SECOND independent source. Agreement strengthens
          // confidence; disagreement must be flagged, never silently averaged.
          if (target.correct_answers.length && candidateAnswer === target.correct_answers[0]) {
            target.answer_confirmed_twice = true;
          } else if (target.correct_answers.length && candidateAnswer !== target.correct_answers[0]) {
            target.answer_conflict = true;
          }
          unmatchedAnswers.push(a);
        } else {
          unmatchedAnswers.push(a);
        }
      }

      const merged = [
        ...[...objectivePool.values()].sort((a, b) => (a.source_number ?? 0) - (b.source_number ?? 0)),
        ...[...theoryPool.values()].sort((a, b) => (a.source_number ?? 0) - (b.source_number ?? 0)),
        ...unnumbered,
      ];

      const objNumbers = [...objectivePool.keys()].sort((a, b) => a - b);
      const numberGaps = [];
      if (objNumbers.length > 1) {
        for (let n = objNumbers[0]; n < objNumbers[objNumbers.length - 1]; n++) {
          if (!objectivePool.has(n)) numberGaps.push(n);
        }
        if (objNumbers[0] > 1) for (let n = 1; n < objNumbers[0]; n++) numberGaps.unshift(n);
      }

      // ── PASS 3: dedupe ──
      const kept = [];
      const seenThisBatch = new Set();
      let duplicatesSkipped = 0;
      for (const q of merged) {
        const norm = normaliseText(q.question_text);
        if (existingSet.has(norm) || seenThisBatch.has(norm)) { duplicatesSkipped++; continue; }
        seenThisBatch.add(norm);
        kept.push(q);
      }

      // ── PASS 4: confidence scoring ──
      for (const q of kept) {
        const { score, band, reasons } = computeConfidence(
          { confidence: q.confidence, question_number: q.source_number, question_type: q.question_type,
            options: q.options, correct_answers: q.correct_answers },
          { diagramCropFailed: q.diagram_crop_failed, answerFromSeparateKeyPage: q.answer_from_key_page,
            answerConfirmedByTwoSources: q.answer_confirmed_twice, answerConflict: q.answer_conflict }
        );
        q._confidenceScore = score;
        q._reviewStatus = band;
        q._reviewNotes = reasons.join('; ') || null;
      }

      // ── PASS 5: re-verify anything that scored below 75 ──
      let reverifiedCount = 0;
      for (const q of kept) {
        if (q._confidenceScore >= 75) continue;
        const buffer = photoBuffers[q.source_photo];
        if (!buffer) continue; // shouldn't happen, but never block on it
        try {
          const ext = path.extname(q.source_photo).toLowerCase();
          const mediaType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
          const verdict = await reverifyLowConfidenceQuestion({
            imageBase64: buffer.toString('base64'),
            mediaType,
            draftQuestion: {
              question_number: q.source_number,
              question_text: q.question_text,
              options: q.options,
              correct_answer_letter: q.correct_answers[0]
                ? String.fromCharCode(65 + q.options.indexOf(q.correct_answers[0]))
                : null,
            },
          });
          reverifiedCount++;
          if (verdict.changed_from_draft && verdict.found_on_page !== false) {
            if (verdict.question_text) q.question_text = verdict.question_text;
            if (Array.isArray(verdict.options) && verdict.options.length) q.options = verdict.options;
            if (verdict.correct_answer_letter && q.options.length) {
              const idx = verdict.correct_answer_letter.charCodeAt(0) - 65;
              if (q.options[idx]) q.correct_answers = [q.options[idx]];
            }
            q._reviewNotes = (q._reviewNotes ? q._reviewNotes + '; ' : '') + 'corrected by Pass 5 re-verification';
            // A confirmed correction from a focused second look earns a bump,
            // but stays capped just under auto-verify — a human still glances
            // at anything that needed correcting once, per section 29.
            q._confidenceScore = Math.min(89, q._confidenceScore + 15);
            q._reviewStatus = 'needs_review';
          } else if (verdict.found_on_page === false) {
            q._reviewNotes = (q._reviewNotes ? q._reviewNotes + '; ' : '') + 'Pass 5 could not locate this question on the page — verify manually';
          } else if (!verdict.changed_from_draft && verdict.found_on_page !== false) {
            // Confirmed as-is by a second look — modest bump, still reviewed.
            q._confidenceScore = Math.min(89, q._confidenceScore + 8);
            q._reviewNotes = (q._reviewNotes ? q._reviewNotes + '; ' : '') + 'confirmed unchanged by Pass 5';
          }
        } catch (reverifyErr) {
          console.error('Pass 5 error for', q.source_photo, q.source_number, reverifyErr.message);
        }
      }

      // ── Write staged rows ──
      let verifiedCount = 0, needsReviewCount = 0, conflictCount = 0;
      for (const q of kept) {
        const status = q.answer_conflict ? 'answer_conflict' : q._reviewStatus;
        if (status === 'verified') verifiedCount++;
        else if (status === 'answer_conflict') conflictCount++;
        else needsReviewCount++;

        await db.execute(
          `INSERT INTO staged_questions
           (id, import_batch_id, subject_id, exam_body, year, paper_type, question_number,
            question_text, question_type, options, correct_answers, explanation,
            media_url, source_photo, confidence_score, confidence_label, review_status, review_notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            uuidv4(), batchId, subjectId, examBody, year,
            q.question_type === 'essay' ? 'theory' : paperType,
            q.source_number ?? null,
            q.question_text, q.question_type,
            JSON.stringify(q.options), JSON.stringify(q.correct_answers),
            q.explanation || null, q.media_url, q.source_photo,
            q._confidenceScore, q.confidence, status, q._reviewNotes,
          ]
        );
      }

      const qualityScore = kept.length
        ? Math.round((verifiedCount + needsReviewCount * 0.5) / kept.length * 100)
        : 0;

      await db.execute(
        `UPDATE import_batches SET
         pages_processed=?, pages_failed=?, extracted_count=?, verified_count=?,
         needs_review_count=?, duplicate_count=?, missing_count=?, answer_conflict_count=?,
         number_gaps=?, quality_score=?, status='review'
         WHERE id=?`,
        [pagesProcessed, pagesFailed, kept.length, verifiedCount, needsReviewCount,
         duplicatesSkipped, numberGaps.length, conflictCount,
         JSON.stringify(numberGaps), qualityScore, batchId]
      );

      res.json({
        batch_id: batchId,
        extracted: kept.length,
        verified: verifiedCount,
        needs_review: needsReviewCount,
        answer_conflicts: conflictCount,
        duplicates_skipped: duplicatesSkipped,
        number_gaps: numberGaps,
        reverified: reverifiedCount,
        quality_score: qualityScore,
        pages_processed: pagesProcessed,
        pages_failed: pagesFailed,
      });
    } catch (pipelineErr) {
      console.error('batch pipeline error:', pipelineErr.message);
      await db.execute(`UPDATE import_batches SET status='cancelled' WHERE id=?`, [batchId]).catch(() => {});
      res.status(500).json({ error: 'Import pipeline failed: ' + pipelineErr.message, batch_id: batchId });
    }
  });
});

// GET /api/import/batches — list recent batches
router.get('/', authenticate, authorize('superadmin', 'admin', 'examiner'), async (req, res) => {
  try {
    const db = getDB();
    const [rows] = await db.execute(
      `SELECT ib.*, s.name as subject_name, u.full_name as created_by_name
       FROM import_batches ib
       LEFT JOIN subjects s ON ib.subject_id = s.id
       LEFT JOIN users u ON ib.created_by = u.id
       ORDER BY ib.created_at DESC LIMIT 100`
    );
    res.json({ batches: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/import/batches/:id — one batch's summary
router.get('/:id', authenticate, authorize('superadmin', 'admin', 'examiner'), async (req, res) => {
  try {
    const db = getDB();
    const [rows] = await db.execute(
      `SELECT ib.*, s.name as subject_name FROM import_batches ib
       LEFT JOIN subjects s ON ib.subject_id = s.id WHERE ib.id=?`, [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Batch not found' });
    res.json({ batch: rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/import/batches/:id/staged — review-screen data, optionally filtered by status
router.get('/:id/staged', authenticate, authorize('superadmin', 'admin', 'examiner'), async (req, res) => {
  try {
    const db = getDB();
    const { status } = req.query;
    let where = 'import_batch_id=?';
    const params = [req.params.id];
    if (status) { where += ' AND review_status=?'; params.push(status); }
    const [rows] = await db.execute(
      `SELECT * FROM staged_questions WHERE ${where} ORDER BY paper_type, question_number IS NULL, question_number`,
      params
    );
    res.json({ staged: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/import/batches/:id/staged/:stagedId — admin correction during review
router.put('/:id/staged/:stagedId', authenticate, authorize('superadmin', 'admin', 'examiner'), async (req, res) => {
  try {
    const db = getDB();
    const { question_text, options, correct_answers, explanation, question_number, review_status } = req.body;
    const allowedStatus = ['verified', 'needs_review', 'answer_conflict', 'duplicate', 'missing', 'rejected'];
    await db.execute(
      `UPDATE staged_questions SET
       question_text=COALESCE(?,question_text), options=COALESCE(?,options),
       correct_answers=COALESCE(?,correct_answers), explanation=COALESCE(?,explanation),
       question_number=COALESCE(?,question_number),
       review_status=?, reviewed_by=?, reviewed_at=NOW()
       WHERE id=? AND import_batch_id=?`,
      [
        question_text || null,
        options ? JSON.stringify(options) : null,
        correct_answers ? JSON.stringify(correct_answers) : null,
        explanation || null,
        question_number ?? null,
        allowedStatus.includes(review_status) ? review_status : 'needs_review',
        req.user.id, req.params.stagedId, req.params.id,
      ]
    );
    res.json({ message: 'Staged question updated' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/import/batches/:id/publish — copy verified staged rows into the live question bank
router.post('/:id/publish', authenticate, authorize('superadmin', 'admin'), async (req, res) => {
  try {
    const db = getDB();
    const [batchRows] = await db.execute('SELECT * FROM import_batches WHERE id=?', [req.params.id]);
    const batch = batchRows[0];
    if (!batch) return res.status(404).json({ error: 'Batch not found' });

    const [staged] = await db.execute(
      `SELECT * FROM staged_questions WHERE import_batch_id=? AND review_status='verified' AND published_question_id IS NULL`,
      [req.params.id]
    );
    if (!staged.length) {
      return res.status(400).json({ error: 'No verified, unpublished questions in this batch — review items still marked needs_review/answer_conflict first' });
    }

    let published = 0;
    for (const s of staged) {
      const questionId = uuidv4();
      const tags = [batch.exam_body, String(batch.year)].filter(Boolean);
      await db.execute(
        `INSERT INTO questions
         (id, subject_id, question_text, question_type, options, correct_answers,
          explanation, difficulty, marks, tags, exam_types, media_url, created_by,
          exam_body, paper_type, question_number)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'medium', 1, ?, ?, ?, ?, ?, ?, ?)`,
        [
          questionId, s.subject_id, s.question_text, s.question_type,
          s.options, s.correct_answers, s.explanation,
          JSON.stringify(tags), JSON.stringify([batch.exam_body]),
          s.media_url, req.user.id,
          s.exam_body, s.paper_type, s.question_number,
        ]
      );
      await db.execute('UPDATE staged_questions SET published_question_id=? WHERE id=?', [questionId, s.id]);
      published++;
    }

    const [[{ remaining }]] = await db.execute(
      `SELECT COUNT(*) as remaining FROM staged_questions WHERE import_batch_id=? AND published_question_id IS NULL AND review_status != 'rejected'`,
      [req.params.id]
    );
    if (remaining === 0) {
      await db.execute(`UPDATE import_batches SET status='published' WHERE id=?`, [req.params.id]);
    }

    res.json({ message: `Published ${published} question(s) to the live question bank`, published, remaining_in_review: remaining });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/import/batches/:id — cancel a batch still in review (staged rows cascade-delete)
router.delete('/:id', authenticate, authorize('superadmin', 'admin'), async (req, res) => {
  try {
    const db = getDB();
    const [rows] = await db.execute('SELECT status FROM import_batches WHERE id=?', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Batch not found' });
    if (rows[0].status === 'published') {
      return res.status(400).json({ error: 'This batch has already published questions to the live bank and cannot be deleted — individual questions can still be edited or deactivated from Question Bank' });
    }
    await db.execute('DELETE FROM import_batches WHERE id=?', [req.params.id]);
    res.json({ message: 'Batch cancelled and removed' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
