const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { getDB } = require('../models/db');
const { locateQuestionDiagram } = require('../ai/questionGenerator');
const { cropDiagram } = require('../utils/diagramCrop');

// Companion to services/autoAnswerSolver.js, same shape: small batch, every
// few minutes, forever, no admin action needed. Where that one fills in
// missing correct_answers, this one fills in missing diagram images —
// specifically for questions published with media_url NULL because the
// import-time crop failed (or the question was staged/reviewed before a
// diagram was ever attempted). It re-reads the ORIGINAL archived source page
// photo (source_papers.file_path, kept from the original import — see
// routes/importBatches.js) and asks the AI to locate just that one
// question's figure fresh, then crops it with the same fixed (8pt margin,
// bounds-clamped) logic as every other crop path in this app.
//
// Deliberately scoped to questions whose TEXT suggests a diagram is likely
// referenced (diagram/graph/figure/table/etc. — see NEEDS_DIAGRAM_KEYWORDS
// below) rather than every media_url-less question: most objective
// questions genuinely have no diagram at all, and running a vision call
// against all of them would burn AI quota for almost no benefit. A false
// negative here (a diagram question phrased without any of these words)
// just stays exactly as findable/fixable via the existing manual "Fix /
// Re-crop Diagrams" and "manual-crop" admin tools as before — this doesn't
// replace those, it just catches the common case automatically.
const NEEDS_DIAGRAM_KEYWORDS = [
  'diagram', 'graph', 'figure', 'table', 'chart', 'venn', 'histogram',
  'pie chart', 'bar chart', 'number line', 'shown below', 'shown above',
  'in the figure', 'above shows', 'below shows',
];

const BATCH_SIZE = 5;
const TICK_INTERVAL_MS = 4 * 60 * 1000; // every 4 minutes — separate cadence from the answer-solver so the two don't both hit the AI at once
const DEFAULT_QUOTA_COOLDOWN_MS = 60 * 1000;
const SOURCE_PAPERS_DIR = path.join(__dirname, '..', 'uploads', 'source-papers');
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
// A media_url whose image covers this much of the ORIGINAL page's area (by
// pixel dimensions) is treated as "never really cropped" — either an older
// import version's whole-page fallback (before that behaviour was removed —
// see routes/import.js), or a crop whose box the AI estimated as nearly the
// entire page. Below this the question is left alone as a legitimate,
// already-correct crop.
const WHOLE_PAGE_AREA_RATIO = 0.7;

const keywordWhere = NEEDS_DIAGRAM_KEYWORDS.map(() => 'q.question_text LIKE ?').join(' OR ');
const keywordParams = NEEDS_DIAGRAM_KEYWORDS.map(k => `%${k}%`);

let quotaExhaustedUntil = 0;
let running = false;

function mediaTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
}

// True if the image at mediaUrl is suspiciously close in size to the
// original source page — i.e. it looks like the whole page got stored as
// "the diagram" rather than an actual crop of just one figure. Fails safe
// (false) on any error, since a false positive here would re-crop an
// already-fine diagram and a false negative just leaves a bad one for the
// keyword+NULL pass or the manual admin tool to catch some other way.
async function looksLikeUncroppedPage(mediaUrl, sourceBuffer) {
  if (!mediaUrl || !mediaUrl.startsWith('/uploads/')) return false;
  try {
    const currentPath = path.join(UPLOADS_DIR, mediaUrl.replace(/^\/uploads\//, ''));
    const [currentMeta, sourceMeta] = await Promise.all([
      sharp(currentPath).metadata(),
      sharp(sourceBuffer).metadata(),
    ]);
    if (!currentMeta.width || !currentMeta.height || !sourceMeta.width || !sourceMeta.height) return false;
    const ratio = (currentMeta.width * currentMeta.height) / (sourceMeta.width * sourceMeta.height);
    return ratio >= WHOLE_PAGE_AREA_RATIO;
  } catch (err) {
    return false;
  }
}

async function tick() {
  if (running) return;
  if (Date.now() < quotaExhaustedUntil) return;
  running = true;
  try {
    const db = getDB();

    // Path A: questions imported through the newer staged-review pipeline
    // (routes/importBatches.js) — these know exactly which source_papers
    // row they came from via staged_questions.published_question_id.
    const [directRows] = await db.execute(
      `SELECT q.id, q.question_text, q.question_number, q.media_url,
              sp.file_path AS source_file_path
       FROM questions q
       JOIN staged_questions sq ON sq.published_question_id = q.id
       JOIN source_papers sp ON sp.id = sq.source_paper_id
       WHERE q.is_active = TRUE
         AND q.diagram_checked_at IS NULL
         AND sp.file_path IS NOT NULL
         AND (${keywordWhere})
       LIMIT ${BATCH_SIZE}`,
      keywordParams
    );

    // Path B: questions imported through the OLDER, direct pipeline
    // (routes/import.js) — these were inserted straight into `questions`
    // with no staged_questions row at all, so there's no exact link back to
    // a specific source_papers page. The best we can do is narrow by
    // exam_body + subject_id + the year embedded in `tags` (see
    // routes/import.js — tags always include the exam_body and year
    // strings), which usually leaves a handful of page photos to check
    // rather than one exact match. locateQuestionDiagram's found_on_page
    // flag is what actually confirms which (if any) of those pages is the
    // right one — see the search loop below.
    const remainingSlots = Math.max(0, BATCH_SIZE - directRows.length);
    let fallbackRows = [];
    if (remainingSlots > 0) {
      const [rows] = await db.execute(
        `SELECT q.id, q.question_text, q.question_number, q.media_url, q.exam_body, q.subject_id, q.tags
         FROM questions q
         LEFT JOIN staged_questions sq ON sq.published_question_id = q.id
         WHERE q.is_active = TRUE
           AND q.diagram_checked_at IS NULL
           AND sq.id IS NULL
           AND q.exam_body IS NOT NULL
           AND (${keywordWhere})
         LIMIT ${remainingSlots}`,
        keywordParams
      );
      fallbackRows = rows;
    }

    if (!directRows.length && !fallbackRows.length) return; // quiet until new gaps appear

    let cropped = 0, noDiagramFound = 0, cropFailed = 0, alreadyFine = 0, noPageMatch = 0;

    // ── Path A: exact source page already known ──
    for (const question of directRows) {
      const fullPath = path.join(SOURCE_PAPERS_DIR, question.source_file_path);
      let buffer;
      try {
        buffer = fs.readFileSync(fullPath);
      } catch (err) {
        await db.execute('UPDATE questions SET diagram_checked_at=NOW() WHERE id=?', [question.id]);
        continue;
      }

      if (question.media_url && !(await looksLikeUncroppedPage(question.media_url, buffer))) {
        await db.execute('UPDATE questions SET diagram_checked_at=NOW() WHERE id=?', [question.id]);
        alreadyFine++;
        continue;
      }

      let verdict;
      try {
        verdict = await locateQuestionDiagram({
          imageBase64: buffer.toString('base64'),
          mediaType: mediaTypeFor(fullPath),
          question_number: question.question_number,
          question_text: question.question_text,
        });
      } catch (err) {
        if (err.isQuotaExceeded) {
          quotaExhaustedUntil = Date.now() + (err.retryDelaySeconds ? err.retryDelaySeconds * 1000 : DEFAULT_QUOTA_COOLDOWN_MS);
          console.log(`🖼️  Auto-cropper: AI quota reached, pausing until ${new Date(quotaExhaustedUntil).toISOString()}`);
          break;
        }
        continue;
      }

      if (verdict.has_diagram && verdict.diagram_box) {
        const url = await cropDiagram(buffer, verdict.diagram_box);
        if (url) {
          await db.execute('UPDATE questions SET media_url=?, diagram_checked_at=NOW(), answer_solve_attempted_at=NULL WHERE id=?', [url, question.id]);
          cropped++;
        } else {
          await db.execute('UPDATE questions SET diagram_checked_at=NOW() WHERE id=?', [question.id]);
          cropFailed++;
        }
      } else if (!question.media_url) {
        await db.execute('UPDATE questions SET diagram_checked_at=NOW() WHERE id=?', [question.id]);
        noDiagramFound++;
      } else {
        await db.execute('UPDATE questions SET diagram_checked_at=NOW() WHERE id=?', [question.id]);
        cropFailed++;
      }
    }

    // ── Path B: search candidate pages for questions with no direct link ──
    const MAX_PAGES_TO_SEARCH = 4; // bounds AI calls per question when the exam_body+year+subject match is broad
    for (const question of fallbackRows) {
      if (Date.now() < quotaExhaustedUntil) break; // hit quota partway through Path A or an earlier Path B question — stop entirely, don't keep hammering the rest of this batch in the same tick
      let year = null;
      try {
        const tags = Array.isArray(question.tags) ? question.tags : JSON.parse(question.tags || '[]');
        year = tags.find(t => /^(19|20)\d{2}$/.test(String(t).trim()));
      } catch { /* no usable year tag — subject_id/exam_body alone still narrows it down */ }

      const params = [question.exam_body];
      let whereClause = 'exam_body = ?';
      if (year) { whereClause += ' AND year = ?'; params.push(year); }
      if (question.subject_id) { whereClause += ' AND subject_id = ?'; params.push(question.subject_id); }

      const [pages] = await db.execute(
        `SELECT file_path FROM source_papers WHERE ${whereClause} AND file_path IS NOT NULL LIMIT ${MAX_PAGES_TO_SEARCH}`,
        params
      );
      if (!pages.length) {
        // No archived page even matches this question's own exam_body/year/
        // subject — nothing to search, and won't suddenly appear later.
        await db.execute('UPDATE questions SET diagram_checked_at=NOW() WHERE id=?', [question.id]);
        noPageMatch++;
        continue;
      }

      let found = false;
      for (const page of pages) {
        const fullPath = path.join(SOURCE_PAPERS_DIR, page.file_path);
        let buffer;
        try { buffer = fs.readFileSync(fullPath); } catch { continue; }

        if (question.media_url && !(await looksLikeUncroppedPage(question.media_url, buffer))) {
          // media_url already looks like a fine crop relative to THIS
          // candidate page's size — treat it as confirmed rather than
          // searching further pages unnecessarily.
          found = true;
          await db.execute('UPDATE questions SET diagram_checked_at=NOW() WHERE id=?', [question.id]);
          alreadyFine++;
          break;
        }

        let verdict;
        try {
          verdict = await locateQuestionDiagram({
            imageBase64: buffer.toString('base64'),
            mediaType: mediaTypeFor(fullPath),
            question_number: question.question_number,
            question_text: question.question_text,
          });
        } catch (err) {
          if (err.isQuotaExceeded) {
            quotaExhaustedUntil = Date.now() + (err.retryDelaySeconds ? err.retryDelaySeconds * 1000 : DEFAULT_QUOTA_COOLDOWN_MS);
            console.log(`🖼️  Auto-cropper: AI quota reached, pausing until ${new Date(quotaExhaustedUntil).toISOString()}`);
            found = true; // stop searching further pages/questions this tick — not "found", just bailing out cleanly
            break;
          }
          continue; // this page failed to analyze — try the next candidate page
        }

        if (verdict.found_on_page) {
          found = true;
          if (verdict.has_diagram && verdict.diagram_box) {
            const url = await cropDiagram(buffer, verdict.diagram_box);
            if (url) {
              await db.execute('UPDATE questions SET media_url=?, diagram_checked_at=NOW(), answer_solve_attempted_at=NULL WHERE id=?', [url, question.id]);
              cropped++;
            } else {
              await db.execute('UPDATE questions SET diagram_checked_at=NOW() WHERE id=?', [question.id]);
              cropFailed++;
            }
          } else {
            await db.execute('UPDATE questions SET diagram_checked_at=NOW() WHERE id=?', [question.id]);
            noDiagramFound++;
          }
          break; // found the right page — no need to check the remaining candidates
        }
        // found_on_page: false — wrong page, keep searching the next candidate
      }
      if (!found) {
        // Searched every candidate page and never found this question on
        // any of them — most likely the paper spans more pages than were
        // archived, or the question text drifted enough from the page scan
        // that the model couldn't match it. Mark checked so this doesn't
        // re-run every tick; the manual "Fix / Re-crop Diagrams" tool still
        // works for it if someone wants to chase it down by hand.
        await db.execute('UPDATE questions SET diagram_checked_at=NOW() WHERE id=?', [question.id]);
        noPageMatch++;
      }
    }

    if (cropped || noDiagramFound || cropFailed || alreadyFine || noPageMatch) {
      console.log(`🖼️  Auto-cropper: cropped ${cropped}, confirmed-no-diagram ${noDiagramFound}, crop-failed ${cropFailed}, already-fine ${alreadyFine}, no-page-match ${noPageMatch} this batch`);
    }
  } catch (err) {
    console.error('🖼️  Auto-cropper tick failed:', err.message);
  } finally {
    running = false;
  }
}

let intervalHandle = null;

function startAutoDiagramCropper() {
  if (intervalHandle) return;
  console.log(`🖼️  Auto-cropper started — checking for questions missing a diagram every ${TICK_INTERVAL_MS / 60000} min`);
  intervalHandle = setInterval(tick, TICK_INTERVAL_MS);
  setTimeout(tick, 30_000); // offset from the answer-solver's own 15s first run, so they don't both hit the AI in the same instant on boot
}

module.exports = { startAutoDiagramCropper };
