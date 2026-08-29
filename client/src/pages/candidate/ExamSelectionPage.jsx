import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { syllabusAPI } from '../../utils/api';

const cardS = { background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-xl)', padding: '18px', cursor: 'pointer' };

export default function ExamSelectionPage() {
  const { examBodyId } = useParams();
  const navigate = useNavigate();
  const [examBody, setExamBody] = useState(null);
  const [examinations, setExaminations] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([syllabusAPI.examBodies(), syllabusAPI.examinations(examBodyId)])
      .then(([bodiesRes, examsRes]) => {
        setExamBody((bodiesRes.data.exam_bodies || []).find(b => b.id === examBodyId) || null);
        setExaminations(examsRes.data.examinations || []);
      })
      .catch(() => toast.error('Could not load examinations'))
      .finally(() => setLoading(false));
  }, [examBodyId]);

  if (loading) return <p style={{ padding: 20, color: 'var(--text-muted)' }}>Loading…</p>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '16px' }}>
      <button onClick={() => navigate('/exam/prep')} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 13, cursor: 'pointer', textAlign: 'left', padding: 0 }}>← All Exam Bodies</button>
      <h1 style={{ fontSize: '1.4rem' }}>{examBody?.name || 'Examinations'}</h1>

      {examinations.length === 0 ? (
        <div style={cardS}><p style={{ color: 'var(--text-muted)', fontSize: 14 }}>No examinations set up for {examBody?.name} yet.</p></div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {examinations.map(e => (
            <div key={e.id} style={cardS} onClick={() => navigate(`/exam/prep/${examBodyId}/${e.id}`)}>
              <p style={{ fontWeight: 800, fontSize: 15 }}>{e.name}</p>
              {e.description && <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{e.description}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
