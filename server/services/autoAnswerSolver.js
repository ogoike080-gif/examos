const { getDB } = require('../models/db');
const { solveAndSaveMissingAnswer } = require('./answerSolver');

// Before this existed, fixing a question with no recorded correct_answers
// required an admin to notice it (usually because a student hit a 400
// somewhere) and manually click "Fix Missing Correct Answers" in the
// Question Bank, possibly more than once until it worked through the whole
// backlog. This runs the exact same AI-solve logic continuously in the
// background instead — small batch, every few minutes, forever — so the
// live question bank keeps healing itself with no one needing to click
// anything. The admin button still exists for "I want this done right now",
// but it's no longer the only way this happens.
const BATCH_SIZE = 5;
const TICK_INTERVAL_MS = 3 * 60 * 1000; // every 3 minutes
const DEFAULT_QUOTA_COOLDOWN_MS = 60 * 1000;

const WHERE = "q.is_active = TRUE AND q.question_type != 'essay' AND JSON_LENGTH(q.options) >= 2 AND (q.correct_answers IS NULL OR JSON_LENGTH(q.correct_answers) = 0)";

let quotaExhaustedUntil = 0;
let running = false; // re-entrancy guard — a slow tick shouldn't overlap the next timer fire

async function tick() {
  if (running) return;
  if (Date.now() < quotaExhaustedUntil) return; // still cooling down from a prior AI_QUOTA_EXCEEDED
  running = true;
  try {
    const db = getDB();
    const [rows] = await db.execute(
      `SELECT q.id, q.question_text, q.question_type, q.options, q.media_url, s.name AS subject_name
       FROM questions q LEFT JOIN subjects s ON q.subject_id = s.id
       WHERE ${WHERE} LIMIT ${BATCH_SIZE}`
    );
    if (!rows.length) return; // nothing outstanding right now — quiet until new gaps appear

    let fixed = 0, unsolvable = 0;
    for (const question of rows) {
      const result = await solveAndSaveMissingAnswer(db, question);
      if (result.status === 'fixed') fixed++;
      else if (result.status === 'quota_exceeded') {
        quotaExhaustedUntil = Date.now() + (result.retryDelaySeconds ? result.retryDelaySeconds * 1000 : DEFAULT_QUOTA_COOLDOWN_MS);
        console.log(`🤖 Auto-solver: AI quota reached, pausing until ${new Date(quotaExhaustedUntil).toISOString()}`);
        break; // rest of this batch would fail the same way — stop here, resume next tick after cooldown
      } else {
        unsolvable++;
      }
    }
    if (fixed || unsolvable) {
      console.log(`🤖 Auto-solver: fixed ${fixed}, unsolvable ${unsolvable} this batch`);
    }
  } catch (err) {
    console.error('🤖 Auto-solver tick failed:', err.message);
  } finally {
    running = false;
  }
}

let intervalHandle = null;

function startAutoAnswerSolver() {
  if (intervalHandle) return; // already started — server hot-reload/double-init guard
  console.log(`🤖 Auto-solver started — checking for questions missing a correct answer every ${TICK_INTERVAL_MS / 60000} min`);
  intervalHandle = setInterval(tick, TICK_INTERVAL_MS);
  // Also run once shortly after startup rather than waiting a full interval
  // for the first pass.
  setTimeout(tick, 15_000);
}

module.exports = { startAutoAnswerSolver };
