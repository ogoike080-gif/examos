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
    // Two shapes of the same underlying problem, in one query: media_url
    // NULL (never got a diagram at all) and media_url present but never
    // actually checked (might be a fine crop, might be a whole-page
    // fallback from an older import — looksLikeUncroppedPage sorts that out
    // per-row below, since it needs the actual image bytes to compare).
    const [rows] = await db.execute(
      `SELECT q.id, q.question_text, q.question_number, q.media_url, sp.file_path AS source_file_path
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
    if (!rows.length) return; // quiet until new gaps appear

    let cropped = 0, noDiagramFound = 0, cropFailed = 0, alreadyFine = 0;
    for (const question of rows) {
      const fullPath = path.join(SOURCE_PAPERS_DIR, question.source_file_path);
      let buffer;
      try {
        buffer = fs.readFileSync(fullPath);
      } catch (err) {
        // Archived photo itself is gone from disk (e.g. a deploy without a
        // persistent volume wiped uploads/) — nothing this job can do about
        // that, and retrying it every tick forever would be pointless.
        // Marking it checked keeps it out of future batches; the manual
        // "Fix / Re-crop Diagrams" tool (which asks for a fresh zip upload)
        // is the real recovery path for this specific failure.
        await db.execute('UPDATE questions SET diagram_checked_at=NOW() WHERE id=?', [question.id]);
        continue;
      }

      // A media_url is already set — only worth re-checking if it looks
      // like it's actually the whole page rather than a real crop. If it's
      // a normal, properly-sized crop, leave it alone: don't burn an AI
      // call re-verifying something that isn't broken.
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
          break; // leave diagram_checked_at untouched — this one gets retried once quota resets
        }
        continue; // any other AI error — leave unmarked, try again next tick
      }

      if (verdict.has_diagram && verdict.diagram_box) {
        const url = await cropDiagram(buffer, verdict.diagram_box);
        if (url) {
          // Clearing answer_solve_attempted_at (not just setting media_url)
          // means autoAnswerSolver.js picks this question back up on its
          // very next tick instead of waiting out the rest of a 24h
          // cooldown from a stale attempt against the old, uncropped image
          // — a fresh diagram is often exactly what makes a previously
          // "unsolvable" question solvable.
          await db.execute('UPDATE questions SET media_url=?, diagram_checked_at=NOW(), answer_solve_attempted_at=NULL WHERE id=?', [url, question.id]);
          cropped++;
        } else {
          await db.execute('UPDATE questions SET diagram_checked_at=NOW() WHERE id=?', [question.id]);
          cropFailed++;
        }
      } else if (!question.media_url) {
        // Confirmed: this question genuinely has no diagram of its own —
        // correctly stays with media_url NULL, just no longer re-checked.
        await db.execute('UPDATE questions SET diagram_checked_at=NOW() WHERE id=?', [question.id]);
        noDiagramFound++;
      } else {
        // Had a whole-page-looking media_url, but the AI also couldn't
        // locate a real figure for this question — leave the existing
        // (imperfect) image in place rather than deleting it down to
        // nothing, but stop re-checking it every tick.
        await db.execute('UPDATE questions SET diagram_checked_at=NOW() WHERE id=?', [question.id]);
        cropFailed++;
      }
    }
    if (cropped || noDiagramFound || cropFailed || alreadyFine) {
      console.log(`🖼️  Auto-cropper: cropped ${cropped}, confirmed-no-diagram ${noDiagramFound}, crop-failed ${cropFailed}, already-fine ${alreadyFine} this batch`);
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
