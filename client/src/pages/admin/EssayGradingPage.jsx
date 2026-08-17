import React, { useState, useEffect } from 'react';
import axios from 'axios';
import toast from 'react-hot-toast';

const API = '/api';

export default function EssayGradingPage() {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState(null);

  useEffect(() => { loadQueue(); }, []);

  const loadQueue = () => {
    setLoading(true);
    axios.get(`${API}/exams/essay-queue`)
      .then(r => setSessions(r.data.sessions || []))
      .catch(() => toast.error('Failed to load essay queue'))
      .finally(() => setLoading(false));
  };

  return (
    <div style={{ padding: '24px 28px', maxWidth: 900 }}>
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '1.6rem', marginBottom: 4 }}>Essay Grading</h1>
      <p style={{ color: 'var(--text-secondary)', fontSize: 13.5, marginBottom: 24 }}>
        Submitted sessions containing essay-type answers. AI suggests a score and feedback — you decide the final mark.
      </p>

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" style={{ width: 26, height: 26, margin: '0 auto' }} /></div>
      ) : sessions.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)', background: 'var(--bg-surface)', borderRadius: 'var(--r-xl)', border: '1px solid var(--border)' }}>
          Nothing to grade right now.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {sessions.map(s => (
            <SessionRow
              key={s.session_id}
              session={s}
              isOpen={openId === s.session_id}
              onToggle={() => setOpenId(openId === s.session_id ? null : s.session_id)}
              onGraded={loadQueue}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SessionRow({ session, isOpen, onToggle, onGraded }) {
  const [items, setItems] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen && !items) {
      setLoading(true);
      axios.get(`${API}/exams/sessions/${session.session_id}/essay-answers`)
        .then(r => setItems(r.data.items || []))
        .catch(() => toast.error('Failed to load essay answers'))
        .finally(() => setLoading(false));
    }
  }, [isOpen]);

  return (
    <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-xl)', overflow: 'hidden' }}>
      <div
        onClick={onToggle}
        style={{ padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
      >
        <div>
          <div style={{ fontWeight: 700, fontSize: 14 }}>{session.candidate_name}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{session.exam_title} · {new Date(session.submitted_at).toLocaleDateString('en-NG')}</div>
        </div>
        <span style={{ color: 'var(--text-muted)' }}>{isOpen ? '▲' : '▼'}</span>
      </div>

      {isOpen && (
        <div style={{ borderTop: '1px solid var(--border)', padding: '16px 18px' }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: 20 }}><div className="spinner" style={{ width: 20, height: 20, margin: '0 auto' }} /></div>
          ) : (
            (items || []).map(item => (
              <EssayItem key={item.question_id} sessionId={session.session_id} item={item} onGraded={onGraded} />
            ))
          )}
        </div>
      )}
    </div>
  );
}

function EssayItem({ sessionId, item, onGraded }) {
  const [aiGrade, setAiGrade] = useState(item.ai_grade);
  const [grading, setGrading] = useState(false);
  const [score, setScore] = useState(item.awarded_score ?? '');
  const [applying, setApplying] = useState(false);

  const handleAiGrade = async () => {
    setGrading(true);
    try {
      const res = await axios.post(`${API}/exams/sessions/${sessionId}/questions/${item.question_id}/grade-essay`);
      setAiGrade(res.data.grading);
      if (res.data.grading?.score !== undefined) setScore(res.data.grading.score);
      toast.success('AI suggestion ready — review before applying');
    } catch (err) {
      toast.error(err.response?.data?.error || 'AI grading failed');
    } finally { setGrading(false); }
  };

  const handleApply = async () => {
    if (score === '' || isNaN(Number(score))) return toast.error('Enter a valid score');
    setApplying(true);
    try {
      await axios.post(`${API}/exams/sessions/${sessionId}/questions/${item.question_id}/apply-essay-score`, { score: Number(score) });
      toast.success('Score applied to session');
      onGraded();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to apply score');
    } finally { setApplying(false); }
  };

  return (
    <div style={{ padding: '14px 0', borderBottom: '1px solid var(--border)' }}>
      <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 8 }}>{item.question_text}</div>
      <div style={{ fontSize: 13, background: 'var(--bg-raised)', borderRadius: 'var(--r)', padding: '10px 12px', marginBottom: 10, whiteSpace: 'pre-wrap' }}>
        {item.candidate_answer || <em style={{ color: 'var(--text-muted)' }}>No answer submitted</em>}
      </div>

      {!item.marking_guide && (
        <div style={{ fontSize: 12, color: 'var(--warning)', marginBottom: 10 }}>
          ⚠ No marking guide set for this question — add one to the question's Explanation field before AI grading.
        </div>
      )}

      {aiGrade && (
        <div style={{ background: 'var(--brand-dim)', border: '1px solid var(--border)', borderRadius: 'var(--r)', padding: '10px 12px', marginBottom: 10, fontSize: 12.5 }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>🤖 AI suggests: {aiGrade.score}/{item.max_marks} ({aiGrade.grade})</div>
          <div style={{ color: 'var(--text-secondary)', marginBottom: 6 }}>{aiGrade.feedback}</div>
          {aiGrade.strengths?.length > 0 && <div><strong>Strengths:</strong> {aiGrade.strengths.join(', ')}</div>}
          {aiGrade.weaknesses?.length > 0 && <div><strong>To improve:</strong> {aiGrade.weaknesses.join(', ')}</div>}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button onClick={handleAiGrade} disabled={grading || !item.marking_guide} style={{
          padding: '7px 14px', borderRadius: 'var(--r)', border: '1px solid var(--border-md)',
          background: 'var(--bg-raised)', color: 'var(--text-primary)', fontSize: 12.5, fontWeight: 600,
          cursor: item.marking_guide ? 'pointer' : 'not-allowed', opacity: item.marking_guide ? 1 : 0.5,
        }}>
          {grading ? 'Grading…' : '🤖 AI Grade'}
        </button>
        <input
          type="number" min={0} max={item.max_marks} value={score}
          onChange={e => setScore(e.target.value)}
          placeholder={`/ ${item.max_marks}`}
          style={{ width: 70, padding: '7px 10px', borderRadius: 'var(--r)', border: '1px solid var(--border-md)', background: 'var(--bg-base)', color: 'var(--text-primary)', fontSize: 12.5 }}
        />
        <button onClick={handleApply} disabled={applying} style={{
          padding: '7px 14px', borderRadius: 'var(--r)', border: 'none',
          background: 'var(--success)', color: '#fff', fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
        }}>
          {applying ? 'Applying…' : '✓ Apply Score'}
        </button>
        {item.awarded_score !== null && <span style={{ fontSize: 11.5, color: 'var(--success)' }}>Currently applied: {item.awarded_score}/{item.max_marks}</span>}
      </div>
    </div>
  );
}
