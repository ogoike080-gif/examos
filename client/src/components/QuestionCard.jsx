import React from 'react';
import MathText from './MathText';
import ExplanationBox from './ExplanationBox';

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

/**
 * The consistent LMS question card — used anywhere a question is presented
 * to a student, and by the admin Preview so a reviewer sees exactly what a
 * student will see before publishing. Purely presentational: all state
 * (selection, reveal, navigation) is owned by the caller.
 */
export default function QuestionCard({
  subject,
  examBody,
  mode = 'PRACTICE',
  index,          // 1-based position in the current session/list
  total,
  question,       // { question_text, diagram_svg, media_url, options, correct_answers, explanation }
  selected,       // the option string the student picked, or null
  onSelect,       // (option) => void
  revealed = false,
  disabled = false,
}) {
  if (!question) return null;
  const options = Array.isArray(question.options) ? question.options
    : (() => { try { return JSON.parse(question.options || '[]'); } catch { return []; } })();
  const correct = Array.isArray(question.correct_answers) ? question.correct_answers
    : (() => { try { return JSON.parse(question.correct_answers || '[]'); } catch { return []; } })();

  const progressPercent = total ? Math.round((index / total) * 100) : 0;

  return (
    <div style={{
      background: '#fff', border: '1px solid #E2E8F0', borderRadius: 16,
      boxShadow: '0 1px 4px rgba(0,0,0,0.05)', overflow: 'hidden', maxWidth: 640,
    }}>
      {/* Header */}
      <div style={{ padding: '16px 22px 0' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
          <p style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.06em', color: '#0F172A', textTransform: 'uppercase', margin: 0 }}>
            {subject}
          </p>
          <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', color: '#94A3B8', margin: 0 }}>
            {examBody} • {mode}
          </p>
        </div>
        {total ? (
          <>
            <div style={{ display: 'inline-block', padding: '3px 12px', borderRadius: 999, background: '#EFF6FF', color: '#2563EB', fontSize: 12, fontWeight: 700, marginBottom: 10 }}>
              Question {index} of {total}
            </div>
            <div style={{ height: 5, background: '#F1F5F9', borderRadius: 3, overflow: 'hidden', marginBottom: 14 }}>
              <div style={{ width: `${progressPercent}%`, height: '100%', background: '#2563EB', transition: 'width 0.2s' }} />
            </div>
          </>
        ) : <div style={{ marginBottom: 4 }} />}
      </div>

      {/* Question text + diagram */}
      <div style={{ padding: '0 22px 18px' }}>
        <div style={{ fontSize: 15, lineHeight: 1.85, color: '#1E293B', fontWeight: 500, marginBottom: question.diagram_svg || question.media_url ? 14 : 0 }}>
          <MathText text={question.question_text} />
        </div>
        {question.diagram_svg ? (
          <div style={{ maxWidth: '100%' }} dangerouslySetInnerHTML={{ __html: question.diagram_svg }} />
        ) : question.media_url ? (
          <img src={question.media_url} alt="Question diagram" style={{ display: 'block', maxWidth: '100%', maxHeight: 320, borderRadius: 10, border: '1px solid #E2E8F0' }} />
        ) : null}
      </div>

      {/* Options */}
      <div style={{ padding: '0 22px 22px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {options.map((opt, i) => {
          const isSelected = selected === opt;
          const isCorrect = correct.includes(opt);
          let bg = '#fff', border = '#E2E8F0', color = '#1E293B';
          if (revealed) {
            if (isCorrect) { bg = '#F0FDF4'; border = '#86EFAC'; color = '#16A34A'; }
            else if (isSelected) { bg = '#FEF2F2'; border = '#FCA5A5'; color = '#DC2626'; }
          } else if (isSelected) { bg = '#EFF6FF'; border = '#93C5FD'; color = '#1D4ED8'; }

          return (
            <button
              key={i}
              onClick={() => !disabled && onSelect && onSelect(opt)}
              disabled={disabled}
              style={{
                display: 'flex', alignItems: 'flex-start', gap: 10, textAlign: 'left',
                padding: '12px 14px', borderRadius: 10, border: `1.5px solid ${border}`,
                background: bg, color, cursor: disabled ? 'default' : 'pointer', fontSize: 14,
                width: '100%', fontFamily: 'inherit',
              }}
            >
              <span style={{ fontWeight: 800, fontSize: 12, color: '#94A3B8', minWidth: 16 }}>{LETTERS[i]}</span>
              <span style={{ flex: 1 }}><MathText text={opt} inline /></span>
              {revealed && isCorrect && <span>✓</span>}
              {revealed && isSelected && !isCorrect && <span>✗</span>}
            </button>
          );
        })}
      </div>

      {/* Explanation */}
      {revealed && (
        <div style={{ margin: '0 22px 22px' }}>
          <ExplanationBox question={question} theme="light" />
        </div>
      )}
    </div>
  );
}
