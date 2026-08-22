import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { syllabusAPI, textbookAPI, questionAPI } from '../../utils/api';
import MathText from '../../components/MathText';

const sectionS = { marginBottom: 18 };
const sectionTitleS = { fontSize: 13, fontWeight: 800, color: 'var(--brand-light)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' };
const bodyTextS = { fontSize: 14, lineHeight: 1.6, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' };
const actionBtnS = (disabled) => ({
  display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', borderRadius: 'var(--r-lg)',
  border: '1.5px solid var(--border)', background: 'var(--bg-surface)', cursor: disabled ? 'not-allowed' : 'pointer',
  opacity: disabled ? 0.5 : 1, width: '100%', textAlign: 'left',
});

export default function TopicLearningPage() {
  const { topicId } = useParams();
  const navigate = useNavigate();
  const [topic, setTopic] = useState(null);
  const [content, setContent] = useState(null);
  const [progress, setProgress] = useState(null);
  const [reading, setReading] = useState(false);
  const [recommendedReading, setRecommendedReading] = useState([]);
  const [loading, setLoading] = useState(true);
  const [completing, setCompleting] = useState(false);

  // Inline practice mode — fetches topic-tagged live questions and steps
  // through them one at a time with immediate feedback. Deliberately simple
  // rather than reusing the full PracticeMode/StudyApp session apparatus
  // (timer, bookmarking, etc.) — this is meant as quick topic reinforcement,
  // not a formal timed session.
  const [practicing, setPracticing] = useState(false);
  const [practiceLoading, setPracticeLoading] = useState(false);
  const [practiceQuestions, setPracticeQuestions] = useState([]);
  const [practiceIndex, setPracticeIndex] = useState(0);
  const [practiceSelected, setPracticeSelected] = useState(null);
  const [practiceScore, setPracticeScore] = useState(0);
  const [practiceDone, setPracticeDone] = useState(false);

  useEffect(() => { load(); }, [topicId]);

  const load = async () => {
    setLoading(true);
    try {
      const [topicRes, contentRes, progressRes, readingRes] = await Promise.all([
        syllabusAPI.getTopic(topicId),
        syllabusAPI.getPublishedContent(topicId),
        syllabusAPI.topicProgress(topicId),
        textbookAPI.recommendedReading(topicId),
      ]);
      setTopic(topicRes.data.topic);
      setContent(contentRes.data.content);
      setProgress(progressRes.data.progress);
      setRecommendedReading(readingRes.data.reading || []);
    } catch {
      toast.error('Could not load this topic');
    } finally {
      setLoading(false);
    }
  };

  const openReading = async () => {
    setReading(true);
    try {
      await syllabusAPI.startTopic(topicId);
      setProgress(p => p?.status === 'not_started' || !p ? { ...p, status: 'in_progress', progress_percent: 10 } : p);
    } catch { /* non-critical — reading still shown even if the progress ping fails */ }
  };

  const startPractice = async () => {
    setPracticeLoading(true);
    try {
      const res = await questionAPI.list({ topic_id: topicId, limit: 15 });
      const qs = res.data.questions || [];
      if (qs.length === 0) {
        toast('No practice questions tagged to this topic yet.', { icon: 'ℹ️' });
        setPracticeLoading(false);
        return;
      }
      setPracticeQuestions(qs);
      setPracticeIndex(0);
      setPracticeSelected(null);
      setPracticeScore(0);
      setPracticeDone(false);
      setPracticing(true);
      await syllabusAPI.startTopic(topicId).catch(() => {});
    } catch {
      toast.error('Could not load practice questions');
    } finally {
      setPracticeLoading(false);
    }
  };

  const parseOptions = (v) => { try { return Array.isArray(v) ? v : JSON.parse(v || '[]'); } catch { return []; } };
  const parseAnswers = (v) => { try { return Array.isArray(v) ? v : JSON.parse(v || '[]'); } catch { return []; } };

  const selectPracticeAnswer = (option) => {
    if (practiceSelected !== null) return; // already answered this one
    setPracticeSelected(option);
    const q = practiceQuestions[practiceIndex];
    if (parseAnswers(q.correct_answers).includes(option)) setPracticeScore(s => s + 1);
  };

  const nextPracticeQuestion = () => {
    if (practiceIndex + 1 >= practiceQuestions.length) {
      setPracticeDone(true);
    } else {
      setPracticeIndex(i => i + 1);
      setPracticeSelected(null);
    }
  };

  const markComplete = async () => {
    setCompleting(true);
    try {
      await syllabusAPI.completeTopic(topicId);
      toast.success('Topic marked as completed 🎉');
      setProgress(p => ({ ...p, status: 'completed', progress_percent: 100 }));
    } catch {
      toast.error('Could not update progress');
    } finally {
      setCompleting(false);
    }
  };

  if (loading) return <p style={{ padding: 20, color: 'var(--text-muted)' }}>Loading…</p>;
  if (!topic) return <p style={{ padding: 20, color: 'var(--danger)' }}>Topic not found.</p>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, padding: '16px', maxWidth: 720, margin: '0 auto' }}>
      <button onClick={() => navigate(-1)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 13, cursor: 'pointer', textAlign: 'left', padding: 0 }}>← Back</button>

      <div>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>
          {topic.exam_body_name} {topic.examination_name} — {topic.subject_name}
        </p>
        <h1 style={{ fontSize: '1.5rem', marginBottom: 8 }}>Topic: {topic.name}</h1>
        {progress && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ flex: 1, maxWidth: 200, height: 6, background: 'var(--bg-raised)', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ width: `${progress.progress_percent}%`, height: '100%', background: progress.status === 'completed' ? 'var(--success)' : 'var(--brand-light)' }} />
            </div>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{progress.progress_percent}% • {progress.status.replace('_', ' ')}</span>
          </div>
        )}
      </div>

      {recommendedReading.length > 0 && (
        <div style={{ padding: 16, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-xl)' }}>
          <p style={sectionTitleS}>📖 Recommended Reading</p>
          {recommendedReading.map(r => (
            <div key={r.chapter_id} style={{ marginBottom: 10, paddingBottom: 10, borderBottom: '1px solid var(--border)' }}>
              <p style={{ fontSize: 13, fontWeight: 700 }}>{r.textbook_title}</p>
              {r.author && <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>{r.author}</p>}
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>Chapter: {r.chapter_title}</p>
              <a href={r.url} target="_blank" rel="noreferrer"
                style={{ display: 'inline-block', fontSize: 13, fontWeight: 700, color: 'var(--brand-light)', textDecoration: 'none' }}>
                Read Textbook Section →
              </a>
            </div>
          ))}
        </div>
      )}

      {practicing ? (
        <div style={{ padding: 16, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-xl)' }}>
          <button onClick={() => setPracticing(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 13, cursor: 'pointer', textAlign: 'left', padding: 0, marginBottom: 12 }}>← Back to topic overview</button>

          {practiceDone ? (
            <div style={{ textAlign: 'center', padding: 20 }}>
              <p style={{ fontSize: 32, marginBottom: 8 }}>{practiceScore === practiceQuestions.length ? '🎉' : practiceScore >= practiceQuestions.length * 0.6 ? '👍' : '📚'}</p>
              <p style={{ fontSize: 20, fontWeight: 800, marginBottom: 4 }}>{practiceScore} / {practiceQuestions.length}</p>
              <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>
                {practiceScore === practiceQuestions.length ? 'Perfect score!' : practiceScore >= practiceQuestions.length * 0.6 ? 'Good work — a bit more practice and you\'ll have this down.' : 'Worth revisiting the Read Topic material before trying again.'}
              </p>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
                <button onClick={startPractice} style={{ ...actionBtnS(false), width: 'auto', padding: '10px 18px' }}>Practice Again</button>
                <button onClick={() => setPracticing(false)} style={{ ...actionBtnS(false), width: 'auto', padding: '10px 18px' }}>Done</button>
              </div>
            </div>
          ) : (() => {
            const q = practiceQuestions[practiceIndex];
            const options = parseOptions(q.options);
            const correct = parseAnswers(q.correct_answers);
            return (
              <div>
                <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>Question {practiceIndex + 1} of {practiceQuestions.length}</p>
                <p style={{ fontSize: 15, fontWeight: 600, marginBottom: 14 }}><MathText text={q.question_text} /></p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
                  {options.map((opt, i) => {
                    const isCorrect = correct.includes(opt);
                    const isSelected = practiceSelected === opt;
                    let bg = 'var(--bg-raised)', border = 'var(--border)', color = 'var(--text-primary)';
                    if (practiceSelected !== null) {
                      if (isCorrect) { bg = 'var(--success-dim)'; border = 'var(--success)'; color = 'var(--success)'; }
                      else if (isSelected) { bg = 'var(--danger-dim)'; border = 'var(--danger)'; color = 'var(--danger)'; }
                    }
                    return (
                      <button key={i} onClick={() => selectPracticeAnswer(opt)} disabled={practiceSelected !== null}
                        style={{ textAlign: 'left', padding: '12px 14px', borderRadius: 'var(--r-lg)', border: `1.5px solid ${border}`, background: bg, color, cursor: practiceSelected === null ? 'pointer' : 'default', fontSize: 14 }}>
                        {String.fromCharCode(65 + i)}. <MathText text={opt} inline />
                      </button>
                    );
                  })}
                </div>
                {practiceSelected !== null && q.explanation && (
                  <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 14, padding: 12, background: 'var(--bg-raised)', borderRadius: 'var(--r)' }}>
                    <MathText text={q.explanation} />
                  </p>
                )}
                {practiceSelected !== null && (
                  <button onClick={nextPracticeQuestion} style={{ ...actionBtnS(false), width: 'auto', padding: '10px 18px' }}>
                    {practiceIndex + 1 >= practiceQuestions.length ? 'See Results' : 'Next Question →'}
                  </button>
                )}
              </div>
            );
          })()}
        </div>
      ) : !content ? (
        <div style={{ padding: 16, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-xl)' }}>
          <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>
            Study material for this topic hasn't been published yet — check back soon, or ask your teacher to complete it in Exam Body Manager.
          </p>
        </div>
      ) : !reading ? (
        <>
          <div style={{ padding: 16, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-xl)' }}>
            <p style={sectionTitleS}>What You Will Learn</p>
            <MathText text={content.learning_objectives} style={bodyTextS} />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <button style={actionBtnS(false)} onClick={openReading}>
              <span style={{ fontSize: 20 }}>📖</span>
              <div><p style={{ fontWeight: 700, fontSize: 14 }}>Read Topic</p><p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Concepts, formulas, worked examples, and exam tips</p></div>
            </button>
            <button style={actionBtnS(practiceLoading)} onClick={startPractice} disabled={practiceLoading}>
              <span style={{ fontSize: 20 }}>📝</span>
              <div><p style={{ fontWeight: 700, fontSize: 14 }}>Practice Questions</p><p style={{ fontSize: 12, color: 'var(--text-muted)' }}>{practiceLoading ? 'Loading…' : 'Past questions tagged to this topic'}</p></div>
            </button>
            <button style={actionBtnS(true)} disabled title="Coming soon — topic test with auto-scoring">
              <span style={{ fontSize: 20 }}>🎯</span>
              <div><p style={{ fontWeight: 700, fontSize: 14 }}>Topic Test</p><p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Coming soon</p></div>
            </button>
            <button style={actionBtnS(true)} disabled title="Coming soon — AI assistant with topic context">
              <span style={{ fontSize: 20 }}>🤖</span>
              <div><p style={{ fontWeight: 700, fontSize: 14 }}>Explain with AI</p><p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Coming soon</p></div>
            </button>
            <button style={actionBtnS(progress?.status === 'completed')} onClick={markComplete} disabled={completing || progress?.status === 'completed'}>
              <span style={{ fontSize: 20 }}>{progress?.status === 'completed' ? '✅' : '📊'}</span>
              <div><p style={{ fontWeight: 700, fontSize: 14 }}>{progress?.status === 'completed' ? 'Marked as Completed' : 'Mark Topic as Completed'}</p></div>
            </button>
          </div>
        </>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <button onClick={() => setReading(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 13, cursor: 'pointer', textAlign: 'left', padding: 0, marginBottom: 8 }}>← Back to topic overview</button>

          <div style={sectionS}><p style={sectionTitleS}>Key Concepts</p><MathText text={content.key_concepts} style={bodyTextS} /></div>
          {content.formulas && content.formulas.toLowerCase() !== 'none applicable' && (
            <div style={sectionS}><p style={sectionTitleS}>Formulas</p><MathText text={content.formulas} style={bodyTextS} /></div>
          )}
          <div style={sectionS}><p style={sectionTitleS}>Definitions</p><MathText text={content.definitions} style={bodyTextS} /></div>
          <div style={sectionS}><p style={sectionTitleS}>Worked Examples</p><MathText text={content.worked_examples} style={bodyTextS} /></div>
          <div style={sectionS}><p style={sectionTitleS}>Exam Tips</p><MathText text={content.exam_tips} style={bodyTextS} /></div>
          <div style={sectionS}><p style={sectionTitleS}>Common Mistakes</p><MathText text={content.common_mistakes} style={bodyTextS} /></div>

          <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
            This material was AI-drafted and reviewed by your school before publishing.
          </p>

          <button style={{ ...actionBtnS(progress?.status === 'completed'), marginTop: 12 }} onClick={markComplete} disabled={completing || progress?.status === 'completed'}>
            <span style={{ fontSize: 20 }}>{progress?.status === 'completed' ? '✅' : '📊'}</span>
            <div><p style={{ fontWeight: 700, fontSize: 14 }}>{progress?.status === 'completed' ? 'Marked as Completed' : 'Mark Topic as Completed'}</p></div>
          </button>
        </div>
      )}
    </div>
  );
}
