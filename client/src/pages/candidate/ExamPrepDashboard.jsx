import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { syllabusAPI } from '../../utils/api';

const cardS = { background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-xl)', padding: '18px', cursor: 'pointer', transition: 'border-color 0.15s' };

const EXAM_BODY_ICONS = { WAEC: '🟢', JAMB: '🔵', NECO: '🟣', NABTEB: '🟠', NBAIS: '🟡' };

export default function ExamPrepDashboard() {
  const navigate = useNavigate();
  const [examBodies, setExamBodies] = useState([]);
  const [continueLearning, setContinueLearning] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([syllabusAPI.examBodies(), syllabusAPI.continueLearning()])
      .then(([bodiesRes, clRes]) => {
        setExamBodies(bodiesRes.data.exam_bodies || []);
        setContinueLearning(clRes.data.continue_learning);
      })
      .catch(() => toast.error('Could not load exam preparation data'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p style={{ padding: 20, color: 'var(--text-muted)' }}>Loading…</p>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, padding: '16px' }}>
      <div>
        <h1 style={{ fontSize: '1.4rem', marginBottom: 4 }}>🎯 My Exam Preparation</h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Study by topic, track your progress, and prepare systematically for your exam.</p>
      </div>

      {continueLearning && (
        <div
          style={{ ...cardS, background: 'linear-gradient(135deg, var(--brand-light), var(--brand-dark, var(--brand-light)))', border: 'none' }}
          onClick={() => navigate(`/exam/prep/topic/${continueLearning.topic_id}`)}
        >
          <p style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.8)', textTransform: 'uppercase', marginBottom: 6 }}>▶ Continue Learning</p>
          <p style={{ fontSize: 16, fontWeight: 800, color: '#fff', marginBottom: 4 }}>
            {continueLearning.exam_body_name} {continueLearning.subject_name} — {continueLearning.topic_name}
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ flex: 1, height: 6, background: 'rgba(255,255,255,0.25)', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ width: `${continueLearning.progress_percent}%`, height: '100%', background: '#fff' }} />
            </div>
            <span style={{ color: '#fff', fontSize: 12, fontWeight: 700 }}>{continueLearning.progress_percent}%</span>
          </div>
        </div>
      )}

      <div>
        <p style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 10 }}>Choose Your Examination</p>
        {examBodies.length === 0 ? (
          <div style={cardS}>
            <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>
              No exam bodies have been set up yet — check back soon, or ask your school admin to add them under Exam Body Manager.
            </p>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12 }}>
            {examBodies.map(b => (
              <div key={b.id} style={cardS} onClick={() => navigate(`/exam/prep/${b.id}`)}>
                <div style={{ fontSize: 28, marginBottom: 8 }}>{EXAM_BODY_ICONS[b.code] || '📘'}</div>
                <p style={{ fontWeight: 800, fontSize: 15 }}>{b.name}</p>
                {b.description && <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{b.description}</p>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
