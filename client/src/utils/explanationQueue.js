import { questionAPI } from './api';

/**
 * Every screen that reveals a batch of already-answered questions at once
 * (Practice Mode's Review Answers tab, Study mode results, Topic practice
 * results, the candidate's exam review list) mounts one <ExplanationBox>
 * per question simultaneously. Each of those independently called the
 * generate-explanation endpoint on mount, so a 40-question review screen
 * fired 40 parallel AI calls in one burst. The AI provider rate-limits or
 * times out a chunk of those under load, and ExplanationBox never retried a
 * failure — so some questions got their explanation and others were stuck
 * showing "No explanation available", seemingly at random.
 *
 * This module fixes both problems for every ExplanationBox instance at once:
 *   1. A small global concurrency cap (questions queue up and run a few at a
 *      time instead of all at once), which keeps well clear of provider rate
 *      limits regardless of how many questions are on screen.
 *   2. Automatic retry with backoff on failure, so a transient rate-limit or
 *      timeout no longer means "this question never gets an explanation" —
 *      it just takes one more turn in the queue.
 *   3. De-duplication by question id, so if two components ever ask for the
 *      same question (shouldn't normally happen, but is cheap to guard),
 *      only one network request is made and both callers get the result.
 *   4. A daily AI-quota-exhausted response (429 AI_QUOTA_EXCEEDED — see
 *      routes/questions.js) is NOT the same as a transient failure: retrying
 *      it is guaranteed to fail again and just burns more of an
 *      already-exhausted quota. The first time this is seen, every other
 *      question — already queued or requested afterward — short-circuits
 *      immediately without hitting the network at all, until the cooldown
 *      Gemini itself suggested has passed. This is what was showing up as
 *      "explanations skipped on many questions, no matter how simple" — it
 *      was never about the question, every one of them was quietly hitting
 *      the same exhausted quota and failing the same way.
 */

const MAX_CONCURRENT = 3;
const MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 1200;
const DEFAULT_QUOTA_COOLDOWN_MS = 60_000; // used when Gemini doesn't specify a retryDelay

let activeCount = 0;
const pending = []; // FIFO of { run } queued tasks waiting for a free slot
const inFlight = new Map(); // questionId -> Promise, for de-duplication
let quotaExhaustedUntil = 0; // Date.now() timestamp; 0 = not currently exhausted

function pump() {
  while (activeCount < MAX_CONCURRENT && pending.length > 0) {
    const task = pending.shift();
    activeCount++;
    task().finally(() => {
      activeCount--;
      pump();
    });
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function enqueue(run) {
  return new Promise((resolve, reject) => {
    pending.push(() => run().then(resolve, reject));
    pump();
  });
}

function quotaError() {
  const err = new Error('AI explanations are temporarily unavailable — daily quota reached. Try again shortly.');
  err.isQuotaExceeded = true;
  return err;
}

async function attemptWithRetry(questionId) {
  if (Date.now() < quotaExhaustedUntil) throw quotaError();

  let lastErr;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (Date.now() < quotaExhaustedUntil) throw quotaError(); // could have been set by another question's request mid-loop
    try {
      const res = await questionAPI.generateExplanation(questionId);
      return res.data?.explanation || '';
    } catch (err) {
      lastErr = err;
      if (err.response?.data?.code === 'AI_QUOTA_EXCEEDED') {
        const delaySec = err.response.data.retry_delay_seconds;
        quotaExhaustedUntil = Date.now() + (delaySec ? delaySec * 1000 : DEFAULT_QUOTA_COOLDOWN_MS);
        throw err; // guaranteed to fail again right now — don't burn more attempts
      }
      // Don't retry a definitive "this question has no correct answer to
      // explain from" — that won't change on retry. Do retry everything
      // else (rate limits, timeouts, transient 5xx).
      if (err.response?.status === 400) throw err;
      if (attempt < MAX_ATTEMPTS) {
        await sleep(RETRY_BASE_DELAY_MS * attempt);
      }
    }
  }
  throw lastErr;
}

/**
 * Request an explanation for a question, throttled and retried. Safe to
 * call from many simultaneously-mounting components — requests queue up
 * instead of all firing at once, and duplicate calls for the same question
 * id share a single in-flight request.
 */
export function requestExplanation(questionId) {
  if (inFlight.has(questionId)) return inFlight.get(questionId);

  const p = enqueue(() => attemptWithRetry(questionId)).finally(() => {
    inFlight.delete(questionId);
  });
  inFlight.set(questionId, p);
  return p;
}
