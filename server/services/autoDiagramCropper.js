const fs = require('fs');
const path = require('path');
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

const keywordWhere = NEEDS_DIAGRAM_KEYWORDS.map(() => 'q.question_text LIKE ?').join(' OR ');
const keywordParams = NEEDS_DIAGRAM_KEYWORDS.map(k => `%${k}%`);

let quotaExhaustedUntil = 0;
let running = false;

function mediaTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
}

async function tick() {
  if (running) return;
  if (Date.now() < quotaExhaustedUntil) return;
  running = true;
  try {
    const db = getDB();
    const [rows] = await db.execute(
      `SELECT q.id, q.question_text, q.question_number, sp.file_path AS source_file_path
       FROM questions q
       JOIN staged_questions sq ON sq.published_question_id = q.id
       JOIN source_papers sp ON sp.id = sq.source_paper_id
       WHERE q.is_active = TRUE
         AND q.media_url IS NULL
         AND q.diagram_checked_at IS NULL
         AND sp.file_path IS NOT NULL
         AND (${keywordWhere})
       LIMIT ${BATCH_SIZE}`,
      keywordParams
    );
    if (!rows.length) return; // quiet until new gaps appear

    let cropped = 0, noDiagramFound = 0, cropFailed = 0;
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
          await db.execute('UPDATE questions SET media_url=?, diagram_checked_at=NOW() WHERE id=?', [url, question.id]);
          cropped++;
        } else {
          await db.execute('UPDATE questions SET diagram_checked_at=NOW() WHERE id=?', [question.id]);
          cropFailed++;
        }
      } else {
        // Confirmed: this question genuinely has no diagram of its own —
        // correctly stays with media_url NULL, just no longer re-checked.
        await db.execute('UPDATE questions SET diagram_checked_at=NOW() WHERE id=?', [question.id]);
        noDiagramFound++;
      }
    }
    if (cropped || noDiagramFound || cropFailed) {
      console.log(`🖼️  Auto-cropper: cropped ${cropped}, confirmed-no-diagram ${noDiagramFound}, crop-failed ${cropFailed} this batch`);
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
