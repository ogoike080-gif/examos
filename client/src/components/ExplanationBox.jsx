import React, { useState, useEffect, useRef } from 'react';
import MathText from './MathText';
import { requestExplanation } from '../utils/explanationQueue';

// Mirrors isBareAnswerLetter in server/routes/questions.js — MUST stay in
// sync with that copy. Some earlier import path left plenty of questions
// with their explanation column set to nothing but the answer letter itself
// ("A", "Option A", "The answer is A"), which isn't a real explanation, it's
// the same thing the correct-answer checkmark already shows. Without this
// check, that junk text satisfies `question?.explanation` below and the box
// just displays "A" forever, never even asking the server to generate a real
// one — this is what makes the placeholder look like "explanations don't
// work for this question" when actually no attempt was ever made.
function isBareAnswerLetter(text) {
  if (!text) return true;
  let t = text.trim();
  if (!t) return true;
  t = t.replace(/^(the\s+)?(correct\s+)?answer\s*(is|:)?\s*/i, '');
  t = t.replace(/^option\s*/i, '');
  t = t.trim();
  return /^\(?[A-Ea-e]\)?\.?$/.test(t);
}

/**
 * The explanation box shown under a revealed question. Two jobs:
 *
 * 1. Renders explanation text through MathText so $...$ LaTeX shows as real
 *    math instead of raw dollar-sign syntax (previously several pages just
 *    dropped {question.explanation} straight into the DOM as a string).
 *
 * 2. If the question has no explanation yet (common for older/imported
 *    questions), automatically requests one from the server the first time
 *    this box is mounted for that question — no button, no extra click.
 *    The server generates it from the question + known correct answer and
 *    saves it back to the question row, so this only ever costs one AI call
 *    per question globally, not per student/session.
 *
 * Only mount this once a question is actually revealed — it fetches on
 * mount, so mounting it eagerly for every question in a list would trigger
 * generation for questions nobody has looked at yet.
 */
export default function ExplanationBox({ question, onExplanationGenerated, theme = 'light', style }) {
  const initialExplanation = question?.explanation && !isBareAnswerLetter(question.explanation) ? question.explanation : '';
  const [explanation, setExplanation] = useState(initialExplanation);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [quotaExceeded, setQuotaExceeded] = useState(false);
  const requestedFor = useRef(null);

  useEffect(() => {
    setExplanation(question?.explanation && !isBareAnswerLetter(question.explanation) ? question.explanation : '');
    setFailed(false);
    setQuotaExceeded(false);
  }, [question?.id, question?.explanation]);

  useEffect(() => {
    if (!question?.id || explanation) return;
    if (requestedFor.current === question.id) return; // already tried this question
    requestedFor.current = question.id;

    let cancelled = false;
    setLoading(true);
    setFailed(false);
    setQuotaExceeded(false);

    // Goes through the shared queue rather than calling the API directly —
    // when many questions reveal at once (e.g. a full Review Answers
    // screen), this throttles concurrent AI calls and retries transient
    // failures instead of every box racing the API and some silently
    // losing out. See utils/explanationQueue.js.
    requestExplanation(question.id)
      .then((text) => {
        if (cancelled) return;
        if (text) {
          setExplanation(text);
          onExplanationGenerated && onExplanationGenerated(question.id, text);
        } else {
          setFailed(true);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        // Distinguish "the AI provider's daily quota is exhausted" (true of
        // every question right now, nothing wrong with this one, will work
        // again once quota resets) from any other failure — previously both
        // showed the same "No explanation available for this question yet"
        // message, which reads as "we'll never explain this" when it's
        // really "not right now, try again later".
        if (err.isQuotaExceeded) setQuotaExceeded(true);
        else setFailed(true);
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [question?.id, explanation]);

  const dark = theme === 'dark';
  const boxStyle = {
    background: dark ? 'rgba(37,99,235,0.1)' : '#EFF6FF',
    border: `1px solid ${dark ? 'rgba(59,130,246,0.3)' : '#BFDBFE'}`,
    borderRadius: 10,
    padding: '14px 16px',
    fontSize: 13,
    color: dark ? '#BFDBFE' : '#1E40AF',
    lineHeight: 1.7,
    ...style,
  };

  if (!explanation && !loading && quotaExceeded) {
    return (
      <div style={{ ...boxStyle, color: dark ? 'rgba(255,255,255,0.6)' : '#92400E', background: dark ? 'rgba(217,119,6,0.12)' : '#FFFBEB', border: `1px solid ${dark ? 'rgba(217,119,6,0.3)' : '#FDE68A'}`, fontStyle: 'italic' }}>
        Explanations are temporarily unavailable (AI quota reached) — this will work again shortly, try revisiting in a few minutes.
      </div>
    );
  }

  if (!explanation && !loading && failed) {
    return (
      <div style={{ ...boxStyle, color: dark ? 'rgba(255,255,255,0.5)' : '#94A3B8', fontStyle: 'italic' }}>
        No explanation available for this question yet.
      </div>
    );
  }

  return (
    <div style={boxStyle}>
      <div style={{ fontWeight: 700, marginBottom: 6, color: dark ? '#93C5FD' : undefined }}>💡 Explanation</div>
      {!explanation && loading ? (
        <div style={{ opacity: 0.75 }}>Generating explanation…</div>
      ) : (
        <MathText text={explanation} />
      )}
    </div>
  );
}
