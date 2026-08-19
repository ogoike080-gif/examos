import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { syllabusAPI, textbookAPI } from '../../utils/api';

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

      {!content ? (
        <div style={{ padding: 16, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-xl)' }}>
          <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>
            Study material for this topic hasn't been published yet — check back soon, or ask your teacher to complete it in Exam Body Manager.
          </p>
        </div>
      ) : !reading ? (
        <>
          <div style={{ padding: 16, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-xl)' }}>
            <p style={sectionTitleS}>What You Will Learn</p>
            <p style={bodyTextS}>{content.learning_objectives}</p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <button style={actionBtnS(false)} onClick={openReading}>
              <span style={{ fontSize: 20 }}>📖</span>
              <div><p style={{ fontWeight: 700, fontSize: 14 }}>Read Topic</p><p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Concepts, formulas, worked examples, and exam tips</p></div>
            </button>
            <button style={actionBtnS(true)} disabled title="Coming soon — topic-linked practice questions">
              <span style={{ fontSize: 20 }}>📝</span>
              <div><p style={{ fontWeight: 700, fontSize: 14 }}>Practice Questions</p><p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Coming soon</p></div>
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

          <div style={sectionS}><p style={sectionTitleS}>Key Concepts</p><p style={bodyTextS}>{content.key_concepts}</p></div>
          {content.formulas && content.formulas.toLowerCase() !== 'none applicable' && (
            <div style={sectionS}><p style={sectionTitleS}>Formulas</p><p style={bodyTextS}>{content.formulas}</p></div>
          )}
          <div style={sectionS}><p style={sectionTitleS}>Definitions</p><p style={bodyTextS}>{content.definitions}</p></div>
          <div style={sectionS}><p style={sectionTitleS}>Worked Examples</p><p style={bodyTextS}>{content.worked_examples}</p></div>
          <div style={sectionS}><p style={sectionTitleS}>Exam Tips</p><p style={bodyTextS}>{content.exam_tips}</p></div>
          <div style={sectionS}><p style={sectionTitleS}>Common Mistakes</p><p style={bodyTextS}>{content.common_mistakes}</p></div>

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
