import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { syllabusAPI } from '../../utils/api';

const cardS = { background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-xl)', padding: '18px', cursor: 'pointer' };

export default function SubjectSelectionPage() {
  const { examBodyId, examinationId } = useParams();
  const navigate = useNavigate();
  const [subjects, setSubjects] = useState([]);
  const [progress, setProgress] = useState({}); // subjectId -> { percent, topicCount }
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    syllabusAPI.subjects(examinationId)
      .then(async (res) => {
        const subs = res.data.subjects || [];
        setSubjects(subs);
        // One progress fetch per subject to compute an average completion %.
        // Fine for the typical handful of subjects per examination; if this
        // ever needs to scale to dozens, worth a dedicated aggregate endpoint.
        const entries = await Promise.all(subs.map(async s => {
          try {
            const r = await syllabusAPI.subjectProgress(s.id);
            const topics = r.data.topics || [];
            const avg = topics.length ? Math.round(topics.reduce((sum, t) => sum + Number(t.progress_percent), 0) / topics.length) : 0;
            return [s.id, { percent: avg, topicCount: topics.length }];
          } catch { return [s.id, { percent: 0, topicCount: 0 }]; }
        }));
        setProgress(Object.fromEntries(entries));
      })
      .catch(() => toast.error('Could not load subjects'))
      .finally(() => setLoading(false));
  }, [examinationId]);

  if (loading) return <p style={{ padding: 20, color: 'var(--text-muted)' }}>Loading…</p>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '16px' }}>
      <button onClick={() => navigate(`/exam/prep/${examBodyId}`)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 13, cursor: 'pointer', textAlign: 'left', padding: 0 }}>← Back</button>
      <h1 style={{ fontSize: '1.4rem' }}>My Subjects</h1>

      {subjects.length === 0 ? (
        <div style={cardS}><p style={{ color: 'var(--text-muted)', fontSize: 14 }}>No subjects set up for this examination yet.</p></div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {subjects.map(s => {
            const p = progress[s.id] || { percent: 0, topicCount: 0 };
            return (
              <div key={s.id} style={cardS} onClick={() => navigate(`/exam/prep/${examBodyId}/${examinationId}/${s.id}`)}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: p.topicCount ? 8 : 0 }}>
                  <p style={{ fontWeight: 800, fontSize: 15 }}>{s.name}</p>
                  <span style={{ fontSize: 13, fontWeight: 700, color: p.percent >= 70 ? 'var(--success)' : p.percent > 0 ? 'var(--warning)' : 'var(--text-muted)' }}>
                    {p.topicCount ? `${p.percent}% Complete` : 'Not started'}
                  </span>
                </div>
                {p.topicCount > 0 && (
                  <div style={{ height: 5, background: 'var(--bg-raised)', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ width: `${p.percent}%`, height: '100%', background: 'var(--brand-light)' }} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
