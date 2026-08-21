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
const { extractQuestionsFromImage, reverifyLowConfidenceQuestion, solveObjectiveQuestion } = require('../ai/questionGenerator');
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

function mimeFor(name) {
  const lower = name.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
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

      // ── PASS 1: read every photo ──
      // Archive-first: every photo is saved to source_papers and gets a
      // batch_pages row BEFORE extraction is attempted, regardless of whether
      // extraction succeeds. This is what makes single-page retry possible —
      // a failed page's photo is always on disk to retry against, without
      // needing the original zip again.
      const rawQuestions = [];
      const rawAnswers = [];
      let pagesProcessed = 0, pagesFailed = 0;
      const photoImageUrls = {};
      const photoBuffers = {}; // kept in memory for Pass 5 re-verification below

      for (const entry of entries) {
        const filename = entry.entryName.split('/').pop();
        const buffer = entry.getData();
        photoBuffers[filename] = buffer;

        let sourcePaperId = null;
        try {
          const safeBody = safeFolderName(examBody);
          const safeYear = safeFolderName(year);
          const dir = path.join(SOURCE_PAPERS_DIR, safeBody, safeYear);
          fs.mkdirSync(dir, { recursive: true });
          const ext = path.extname(filename) || '.jpg';
          const storedName = `${uuidv4()}${ext}`;
          fs.writeFileSync(path.join(dir, storedName), buffer);
          sourcePaperId = uuidv4();
          photoImageUrls[filename] = { url: `/uploads/source-papers/${safeBody}/${safeYear}/${storedName}`, id: sourcePaperId };
          await db.execute(
            `INSERT INTO source_papers (id, exam_body, year, subject_id, file_path, original_filename, uploaded_by)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [sourcePaperId, examBody, year, subjectId, `${safeBody}/${safeYear}/${storedName}`, filename, req.user.id]
          );
        } catch (archiveErr) {
          console.error('batch source-paper archive error:', archiveErr.message);
        }

        try {
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

          await db.execute(
            `INSERT INTO batch_pages (id, import_batch_id, filename, source_paper_id, status, questions_extracted)
             VALUES (?, ?, ?, ?, 'success', ?)`,
            [uuidv4(), batchId, filename, sourcePaperId, pageQuestions.length]
          );
          pagesProcessed++;
        } catch (photoErr) {
          console.error(`batch zip photo error (${filename}):`, photoErr.message);
          await db.execute(
            `INSERT INTO batch_pages (id, import_batch_id, filename, source_paper_id, status, error_message)
             VALUES (?, ?, ?, ?, 'failed', ?)`,
            [uuidv4(), batchId, filename, sourcePaperId, photoErr.message]
          );
          pagesFailed++;
        }
      }

      // ── PASS 2: match answers to questions by number, detecting conflicts ──
      const objectivePool = new Map();
      const theoryPool = new Map();
      const unnumbered = [];

      rawQuestions.forEach(q => {
        const ownPageAnswer = (q.correct_answer_letter && Array.isArray(q.options))
          ? q.options[q.correct_answer_letter.charCodeAt(0) - 65] : null;
        const merged = {
          question_text: q.question_text,
          question_type: q.question_type === 'essay' ? 'essay' : 'mcq',
          options: Array.isArray(q.options) ? q.options : [],
          correct_answers: ownPageAnswer ? [ownPageAnswer].filter(Boolean) : [],
          explanation: q.explanation || '',
          confidence: q.confidence || 'medium',
          source_photo: q.source_photo,
          source_number: q.number ?? null,
          media_url: q.has_diagram ? (q.diagram_url || (photoImageUrls[q.source_photo] || {}).url || null) : null,
          diagram_crop_failed: !!q.diagram_crop_failed,
          answer_from_key_page: false,
          answer_confirmed_twice: false,
          answer_conflict: false,
          // Every answer this question was ever assigned, with where it came
          // from — not just the winning one. This is what lets the review
          // screen actually show a conflict ("own page said B, p.9 key said
          // C") instead of just flagging that one exists.
          answer_candidates: ownPageAnswer
            ? [{ source: 'own_page', source_photo: q.source_photo, answer: ownPageAnswer }]
            : [],
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

        if (candidateAnswer) {
          target.answer_candidates.push({ source: 'answer_key_page', source_photo: a.source_photo, answer: candidateAnswer });
        }

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
            media_url, source_photo, confidence_score, confidence_label, review_status, review_notes,
            answer_candidates)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            uuidv4(), batchId, subjectId, examBody, year,
            q.question_type === 'essay' ? 'theory' : paperType,
            q.source_number ?? null,
            q.question_text, q.question_type,
            JSON.stringify(q.options), JSON.stringify(q.correct_answers),
            q.explanation || null, q.media_url, q.source_photo,
            q._confidenceScore, q.confidence, status, q._reviewNotes,
            JSON.stringify(q.answer_candidates || []),
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
    let where = 'sq.import_batch_id=?';
    const params = [req.params.id];
    if (status) { where += ' AND sq.review_status=?'; params.push(status); }
    // Bridge through batch_pages (exact 1:1 link created during upload/retry)
    // rather than matching on filename directly — CamScanner-style generic
    // filenames ("CamScanner 2026-08-14...") can repeat across unrelated
    // uploads, so a filename-only join could attach the wrong source image.
    const [rows] = await db.execute(
      `SELECT sq.*, sp.file_path as source_file_path
       FROM staged_questions sq
       LEFT JOIN batch_pages bp
         ON bp.import_batch_id = sq.import_batch_id AND bp.filename = sq.source_photo
       LEFT JOIN source_papers sp ON sp.id = bp.source_paper_id
       WHERE ${where}
       ORDER BY sq.paper_type, sq.question_number IS NULL, sq.question_number`,
      params
    );
    const staged = rows.map(r => ({
      ...r,
      source_page_url: r.source_file_path ? `/uploads/source-papers/${r.source_file_path}` : null,
    }));
    res.json({ staged });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// PUT /api/import/batches/:id/staged/:stagedId — admin correction during review
router.put('/:id/staged/:stagedId', authenticate, authorize('superadmin', 'admin', 'examiner'), async (req, res) => {
  try {
    const db = getDB();
    const { question_text, options, correct_answers, explanation, question_number, review_status, topic_id } = req.body;
    const allowedStatus = ['verified', 'needs_review', 'answer_conflict', 'duplicate', 'missing', 'rejected'];
    await db.execute(
      `UPDATE staged_questions SET
       question_text=COALESCE(?,question_text), options=COALESCE(?,options),
       correct_answers=COALESCE(?,correct_answers), explanation=COALESCE(?,explanation),
       question_number=COALESCE(?,question_number), topic_id=?,
       review_status=?, reviewed_by=?, reviewed_at=NOW()
       WHERE id=? AND import_batch_id=?`,
      [
        question_text || null,
        options ? JSON.stringify(options) : null,
        correct_answers ? JSON.stringify(correct_answers) : null,
        explanation || null,
        question_number ?? null,
        topic_id || null,
        allowedStatus.includes(review_status) ? review_status : 'needs_review',
        req.user.id, req.params.stagedId, req.params.id,
      ]
    );
    res.json({ message: 'Staged question updated' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/import/batches/:id/ai-solve-missing — for every staged question
// in this batch still lacking a correct answer (no answer key was ever found
// for it), attempt to have the AI genuinely solve the problem from its own
// text — distinct from Pass 5's re-verification, which only re-reads the
// page and refuses to guess an unmarked answer. Results are clearly labeled
// as AI-derived in review_notes and NEVER auto-verified — status stays
// needs_review regardless of the AI's own confidence, since a human should
// confirm computational correctness before anything publishes.
router.post('/:id/ai-solve-missing', authenticate, authorize('superadmin', 'admin'), async (req, res) => {
  try {
    const db = getDB();
    const [rows] = await db.execute(
      `SELECT id, question_text, options, question_type FROM staged_questions
       WHERE import_batch_id=? AND question_type='mcq'
       AND (correct_answers IS NULL OR JSON_LENGTH(correct_answers) = 0)
       AND review_status NOT IN ('rejected','duplicate')`,
      [req.params.id]
    );
    if (!rows.length) return res.json({ message: 'No unanswered questions found in this batch', solved: 0, unsolved: 0, attempted: 0 });

    const [batchRows] = await db.execute('SELECT exam_body, subject_id FROM import_batches WHERE id=?', [req.params.id]);
    let subjectName = null;
    if (batchRows[0]?.subject_id) {
      const [s] = await db.execute('SELECT name FROM subjects WHERE id=?', [batchRows[0].subject_id]);
      subjectName = s[0]?.name || null;
    }

    let solved = 0, unsolved = 0;
    for (const row of rows) {
      let options;
      try { options = Array.isArray(row.options) ? row.options : JSON.parse(row.options || '[]'); } catch { options = []; }

      const result = await solveObjectiveQuestion({ question_text: row.question_text, options, subject: subjectName });

      if (result.solvable && result.correct_answer_letter && options[result.correct_answer_letter.charCodeAt(0) - 65]) {
        const answer = options[result.correct_answer_letter.charCodeAt(0) - 65];
        await db.execute(
          `UPDATE staged_questions SET correct_answers=?, explanation=?,
           review_notes = CONCAT(COALESCE(review_notes, ''), IF(review_notes IS NULL OR review_notes = '', '', '; '), ?)
           WHERE id=?`,
          [
            JSON.stringify([answer]),
            result.solution_steps || null,
            `AI-derived answer (${result.confidence || 'unknown'} confidence) — computed, not from an official answer key. Verify before publishing.`,
            row.id,
          ]
        );
        solved++;
      } else {
        unsolved++;
      }
    }

    res.json({ message: `AI-solved ${solved} of ${rows.length} unanswered question(s)`, solved, unsolved, attempted: rows.length });
  } catch (err) {
    console.error('ai-solve-missing error:', err.message);
    res.status(500).json({ error: err.message });
  }
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
          exam_body, paper_type, question_number, topic_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'medium', 1, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          questionId, s.subject_id, s.question_text, s.question_type,
          s.options, s.correct_answers, s.explanation,
          JSON.stringify(tags), JSON.stringify([batch.exam_body]),
          s.media_url, req.user.id,
          s.exam_body, s.paper_type, s.question_number, s.topic_id || null,
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

// GET /api/import/batches/:id/pages — per-page status, for the retry UI
router.get('/:id/pages', authenticate, authorize('superadmin', 'admin', 'examiner'), async (req, res) => {
  try {
    const db = getDB();
    const [pages] = await db.execute(
      `SELECT bp.*, sp.file_path FROM batch_pages bp
       LEFT JOIN source_papers sp ON bp.source_paper_id = sp.id
       WHERE bp.import_batch_id=? ORDER BY bp.filename`,
      [req.params.id]
    );
    res.json({ pages });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/import/batches/:id/pages/:pageId/retry — re-run extraction for
// ONE failed page, without touching the rest of the batch. Reads the photo
// back from disk (archived during the original upload, success or fail — see
// the archive-first restructure in the /zip handler above), re-runs PASS 1
// extraction, PASS 3 dedupe (against both the live bank and this batch's
// existing staged rows), PASS 4 scoring, and PASS 5 re-verification if it
// still scores low. New rows are appended to staged_questions and the
// batch's aggregate counts are updated.
//
// Known scope limit, stated plainly rather than silently: this does NOT
// re-run PASS 2 (cross-page answer-key matching) against the rest of the
// batch — an answer key on a different page won't retroactively attach to
// a question recovered here, and a number recovered here won't retroactively
// resolve another page's previously-unmatched answer entry. Re-running full
// cross-page matching would mean reprocessing the whole batch, which defeats
// the point of a cheap single-page retry. If a retried page's own answer key
// is on the SAME page, that still works — Pass 2 logic runs on this page's
// own rawAnswers/rawQuestions just like it does inside the main batch loop.
router.post('/:id/pages/:pageId/retry', authenticate, authorize('superadmin', 'admin', 'examiner'), async (req, res) => {
  try {
    const db = getDB();
    const [batchRows] = await db.execute('SELECT * FROM import_batches WHERE id=?', [req.params.id]);
    const batch = batchRows[0];
    if (!batch) return res.status(404).json({ error: 'Batch not found' });

    const [pageRows] = await db.execute(
      `SELECT bp.*, sp.file_path FROM batch_pages bp
       LEFT JOIN source_papers sp ON bp.source_paper_id = sp.id
       WHERE bp.id=? AND bp.import_batch_id=?`,
      [req.params.pageId, req.params.id]
    );
    const page = pageRows[0];
    if (!page) return res.status(404).json({ error: 'Page not found in this batch' });
    if (!page.file_path) return res.status(400).json({ error: 'Original photo for this page was not archived — cannot retry, re-upload the source zip instead' });

    const fullPath = path.join(SOURCE_PAPERS_DIR, page.file_path);
    if (!fs.existsSync(fullPath)) {
      return res.status(400).json({ error: 'Archived photo file is missing from disk — cannot retry' });
    }
    const buffer = fs.readFileSync(fullPath);

    const [existingRows] = await db.execute('SELECT question_text FROM questions WHERE is_active = TRUE');
    const [stagedRows] = await db.execute('SELECT question_text FROM staged_questions WHERE import_batch_id=?', [req.params.id]);
    const existingSet = new Set([...existingRows, ...stagedRows].map(r => normaliseText(r.question_text)));

    let result;
    try {
      result = await extractQuestionsFromImage({
        imageBase64: buffer.toString('base64'),
        mediaType: mimeFor(page.filename),
      });
    } catch (extractErr) {
      await db.execute(
        `UPDATE batch_pages SET status='failed', error_message=?, retry_count=retry_count+1 WHERE id=?`,
        [extractErr.message, page.id]
      );
      return res.status(502).json({ error: 'Retry failed again: ' + extractErr.message });
    }

    const pageQuestions = (result.questions || []).filter(q => q.question_text?.trim());
    const pageAnswers = (result.answers || []).filter(a => a.number !== undefined && a.number !== null);

    // Same-page Pass 2: match this page's own answer-key entries to its own
    // questions (see the scope note in the doc comment above this route).
    const numbered = new Map();
    const unnumbered = [];
    pageQuestions.forEach(q => {
      const type = q.question_type === 'essay' ? 'essay' : 'mcq';
      const entry = { ...q, question_type: type, options: q.options || [], correct_answers: [], explanation: q.explanation || '' };
      if (q.number !== undefined && q.number !== null && !numbered.has(q.number)) numbered.set(q.number, entry);
      else unnumbered.push(entry);
    });
    for (const a of pageAnswers) {
      const target = numbered.get(a.number);
      if (!target) continue;
      const candidateAnswer = (a.correct_answer_letter && target.options.length)
        ? target.options[a.correct_answer_letter.charCodeAt(0) - 65] : null;
      if (!target.answer_candidates) target.answer_candidates = target.correct_answers.length
        ? [{ source: 'own_page', source_photo: page.filename, answer: target.correct_answers[0] }] : [];
      if (candidateAnswer) target.answer_candidates.push({ source: 'answer_key_page', source_photo: page.filename, answer: candidateAnswer });
      if (!target.explanation && !target.correct_answers.length) {
        if (a.solution_text) target.explanation = a.solution_text;
        if (candidateAnswer) target.correct_answers = [candidateAnswer];
      }
    }

    const merged = [...numbered.values(), ...unnumbered];
    let inserted = 0, verifiedCount = 0, needsReviewCount = 0;
    const seenThisRetry = new Set();

    for (const q of merged) {
      const norm = normaliseText(q.question_text);
      if (existingSet.has(norm) || seenThisRetry.has(norm)) continue; // duplicate — skip
      seenThisRetry.add(norm);

      let diagramUrl = null;
      if (q.has_diagram) diagramUrl = await cropDiagram(buffer, q.diagram_box);

      const { score, band, reasons } = computeConfidence(
        { confidence: q.confidence || 'medium', question_number: q.number ?? null, question_type: q.question_type,
          options: q.options, correct_answers: q.correct_answers },
        { diagramCropFailed: !!q.has_diagram && !diagramUrl }
      );
      let finalScore = score, finalStatus = band, finalNotes = reasons.join('; ') || null;
      let questionText = q.question_text, options = q.options, correctAnswers = q.correct_answers;

      if (finalScore < 75) {
        try {
          const verdict = await reverifyLowConfidenceQuestion({
            imageBase64: buffer.toString('base64'),
            mediaType: mimeFor(page.filename),
            draftQuestion: {
              question_number: q.number ?? null, question_text: q.question_text, options: q.options,
              correct_answer_letter: correctAnswers[0] ? String.fromCharCode(65 + options.indexOf(correctAnswers[0])) : null,
            },
          });
          if (verdict.changed_from_draft && verdict.found_on_page !== false) {
            if (verdict.question_text) questionText = verdict.question_text;
            if (Array.isArray(verdict.options) && verdict.options.length) options = verdict.options;
            if (verdict.correct_answer_letter && options[verdict.correct_answer_letter.charCodeAt(0) - 65]) {
              correctAnswers = [options[verdict.correct_answer_letter.charCodeAt(0) - 65]];
            }
            finalScore = Math.min(89, finalScore + 15);
            finalNotes = (finalNotes ? finalNotes + '; ' : '') + 'corrected by Pass 5 re-verification (retry)';
          } else if (!verdict.changed_from_draft && verdict.found_on_page !== false) {
            finalScore = Math.min(89, finalScore + 8);
          }
          finalStatus = 'needs_review';
        } catch (reverifyErr) {
          console.error('retry Pass 5 error:', reverifyErr.message);
        }
      }

      if (finalStatus === 'verified') verifiedCount++; else needsReviewCount++;

      await db.execute(
        `INSERT INTO staged_questions
         (id, import_batch_id, subject_id, exam_body, year, paper_type, question_number,
          question_text, question_type, options, correct_answers, explanation,
          media_url, source_photo, confidence_score, confidence_label, review_status, review_notes,
          answer_candidates)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          uuidv4(), req.params.id, batch.subject_id, batch.exam_body, batch.year,
          q.question_type === 'essay' ? 'theory' : batch.paper_type, q.number ?? null,
          questionText, q.question_type, JSON.stringify(options), JSON.stringify(correctAnswers),
          q.explanation || null, diagramUrl, page.filename, finalScore, q.confidence || 'medium',
          finalStatus, finalNotes, JSON.stringify(q.answer_candidates || []),
        ]
      );
      inserted++;
    }

    await db.execute(
      `UPDATE batch_pages SET status='success', error_message=NULL, questions_extracted=?, retry_count=retry_count+1 WHERE id=?`,
      [inserted, page.id]
    );
    await db.execute(
      `UPDATE import_batches SET
       pages_failed = GREATEST(0, pages_failed - 1), pages_processed = pages_processed + 1,
       extracted_count = extracted_count + ?, verified_count = verified_count + ?,
       needs_review_count = needs_review_count + ?
       WHERE id=?`,
      [inserted, verifiedCount, needsReviewCount, req.params.id]
    );

    res.json({ message: `Retry succeeded: ${inserted} question(s) extracted from this page`, inserted, verified: verifiedCount, needs_review: needsReviewCount });
  } catch (err) {
    console.error('page retry error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/import/batches/:id/missing/:number — manually complete a question
// number that PASS 1 never extracted at all (flagged in batch.number_gaps).
// Human-authored, so it's trusted at full confidence and marked verified
// immediately rather than routed through scoring — an admin typing a question
// straight from the paper doesn't need the pipeline to grade its own input.
router.post('/:id/missing/:number', authenticate, authorize('superadmin', 'admin', 'examiner'), async (req, res) => {
  try {
    const db = getDB();
    const number = Number(req.params.number);
    if (!Number.isInteger(number)) return res.status(400).json({ error: 'Invalid question number' });

    const { question_text, options, correct_answer, explanation, question_type } = req.body;
    if (!question_text?.trim()) return res.status(400).json({ error: 'question_text is required' });

    const [batchRows] = await db.execute('SELECT * FROM import_batches WHERE id=?', [req.params.id]);
    const batch = batchRows[0];
    if (!batch) return res.status(404).json({ error: 'Batch not found' });

    const type = question_type === 'essay' ? 'essay' : 'mcq';
    const opts = Array.isArray(options) ? options : [];
    const correct = correct_answer ? [correct_answer] : [];

    await db.execute(
      `INSERT INTO staged_questions
       (id, import_batch_id, subject_id, exam_body, year, paper_type, question_number,
        question_text, question_type, options, correct_answers, explanation,
        confidence_score, confidence_label, review_status, review_notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 100, 'high', 'verified', 'Manually completed by admin — missing from original extraction')`,
      [
        uuidv4(), req.params.id, batch.subject_id, batch.exam_body, batch.year,
        type === 'essay' ? 'theory' : batch.paper_type, number,
        question_text.trim(), type, JSON.stringify(opts), JSON.stringify(correct), explanation || null,
      ]
    );

    const gaps = (() => { try { return JSON.parse(batch.number_gaps || '[]'); } catch { return []; } })();
    const updatedGaps = gaps.filter(n => n !== number);

    await db.execute(
      `UPDATE import_batches SET number_gaps=?, extracted_count=extracted_count+1, verified_count=verified_count+1 WHERE id=?`,
      [JSON.stringify(updatedGaps), req.params.id]
    );

    res.status(201).json({ message: `Question ${number} added and marked verified`, remaining_gaps: updatedGaps });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
