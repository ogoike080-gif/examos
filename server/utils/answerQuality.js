// Shared across routes/questions.js and routes/importBatches.js. Some import
// paths over this app's history have left behind placeholder text instead of
// real content — most commonly the answer letter itself ("A", "A.", "(A)",
// "Option A", "Answer: A") standing in for an actual explanation, or a
// diagram-based answer choice (e.g. "which number line shows...") that the
// extraction pipeline couldn't transcribe, so it wrote the bare letter as the
// option text instead of flagging the question for review. Both cases are
// non-empty strings, so a naive "is this field filled in?" check treats them
// as real content when they're not — this module is the one place that
// actually distinguishes the two.

function isBareAnswerLetter(text) {
  if (!text) return true;
  let t = String(text).trim();
  if (!t) return true;
  // Strip common prefixes so "Option A", "Answer: A", "The answer is A" all
  // reduce to just "A" before the final bare-letter check — a plain regex
  // without this step either misses those phrasings or false-positives on
  // genuine explanations that happen to start with the word "Answer".
  t = t.replace(/^(the\s+)?(correct\s+)?answer\s*(is|:)?\s*/i, '');
  t = t.replace(/^option\s*/i, '');
  t = t.trim();
  return /^\(?[A-Ea-e]\)?\.?$/.test(t);
}

// A multiple-choice question needs at least one option that's real content,
// not just its own letter label — a question where EVERY option is a bare
// letter is indistinguishable from having no options at all, and shouldn't
// reach a student as an answerable question.
function hasRealOptionContent(options) {
  const opts = Array.isArray(options) ? options
    : (() => { try { const p = JSON.parse(options || '[]'); return Array.isArray(p) ? p : []; } catch { return []; } })();
  if (opts.length === 0) return false;
  return opts.some(o => !isBareAnswerLetter(o));
}

module.exports = { isBareAnswerLetter, hasRealOptionContent };
