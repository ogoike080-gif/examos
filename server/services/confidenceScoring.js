// Confidence scoring for imported questions.
//
// The AI returns a self-reported "high|medium|low" label per question, but
// that alone isn't trustworthy — it's the model grading its own homework.
// This combines that label with independently-checkable structural signals
// (does it have a number? complete options? a matched answer? did the crop
// actually work?) into a single 0-100 score, which is what actually decides
// review_status when a staged question is created.
//
// Bands (per spec section 12):
//   90-100  high confidence  -> eligible for "verified" without a second AI pass
//   75-89   good             -> needs_review, but not sent through Pass 5
//   below 75                 -> needs_review AND sent through the Pass 5 re-verify

const LABEL_BASE = { high: 88, medium: 68, low: 42 };

function computeConfidence(question, signals = {}) {
  let score = LABEL_BASE[question.confidence] ?? LABEL_BASE.medium;
  const reasons = [];

  const isMcq = question.question_type !== 'essay';

  // Question number present — a question the AI couldn't number at all is
  // far more likely to be mis-segmented (half of two merged questions, a
  // stray paragraph, etc.)
  if (question.question_number === null || question.question_number === undefined) {
    score -= 15;
    reasons.push('no question number detected');
  }

  if (isMcq) {
    const optCount = Array.isArray(question.options) ? question.options.length : 0;
    if (optCount >= 4) {
      score += 4;
    } else if (optCount > 0) {
      score -= 12;
      reasons.push(`only ${optCount} option(s) found`);
    } else {
      score -= 25;
      reasons.push('no options found for an MCQ question');
    }

    if (Array.isArray(question.correct_answers) && question.correct_answers.length > 0) {
      score += 4;
    } else {
      score -= 10;
      reasons.push('no correct answer set');
    }
  }

  // A diagram was flagged but the crop failed and fell back to the whole
  // page — the question is still usable but worth a human glance.
  if (signals.diagramCropFailed) {
    score -= 6;
    reasons.push('diagram crop fell back to full page');
  }

  // Answer was matched in from a separate answer-key page (Pass 2) rather
  // than being present on the question's own page — slightly less certain
  // since it depended on correct number-matching across two different pages.
  if (signals.answerFromSeparateKeyPage) {
    score -= 3;
  }

  // Two independent signals (own-page answer AND a matching answer-key
  // entry) agreeing is a strong positive signal.
  if (signals.answerConfirmedByTwoSources) {
    score += 8;
  }

  // Explicit conflict between two answer sources is the one case that should
  // never be allowed to average out to a "fine" score — it must always route
  // to mandatory review regardless of arithmetic.
  if (signals.answerConflict) {
    score = Math.min(score, 40);
    reasons.push('answer conflict between two sources');
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  let band;
  if (signals.answerConflict) band = 'answer_conflict';
  else if (score >= 90) band = 'verified';
  else band = 'needs_review';

  return { score, band, reasons };
}

module.exports = { computeConfidence };
