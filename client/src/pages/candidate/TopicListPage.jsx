import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { syllabusAPI } from '../../utils/api';

const cardS = { background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-xl)', padding: '16px', cursor: 'pointer' };

const STATUS_META = {
  completed:      { icon: '🟢', label: 'Completed' },
  in_progress:    { icon: '🔵', label: 'In Progress' },
  not_started:    { icon: '⚪', label: 'Not Started' },
  needs_revision: { icon: '🟠', label: 'Needs Revision' },
};

export default function TopicListPage() {
  const { examBodyId, examinationId, subjectId } = useParams();
  const navigate = useNavigate();
  const [topics, setTopics] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    syllabusAPI.subjectProgress(subjectId)
      .then(r => setTopics(r.data.topics || []))
      .catch(() => toast.error('Could not load topics'))
      .finally(() => setLoading(false));
  }, [subjectId]);

  if (loading) return <p style={{ padding: 20, color: 'var(--text-muted)' }}>Loading…</p>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '16px' }}>
      <button onClick={() => navigate(`/exam/prep/${examBodyId}/${examinationId}`)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 13, cursor: 'pointer', textAlign: 'left', padding: 0 }}>← Back to Subjects</button>
      <h1 style={{ fontSize: '1.4rem' }}>Your Topic Progress</h1>

      {topics.length === 0 ? (
        <div style={cardS}><p style={{ color: 'var(--text-muted)', fontSize: 14 }}>No topics set up for this subject yet.</p></div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {topics.map(t => {
            const meta = STATUS_META[t.status] || STATUS_META.not_started;
            return (
              <div key={t.topic_id} style={cardS} onClick={() => navigate(`/exam/prep/topic/${t.topic_id}`)}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <p style={{ fontWeight: 700, fontSize: 14 }}>{meta.icon} {t.topic_name}</p>
                    <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{meta.label}</p>
                  </div>
                  <span style={{ fontSize: 15, fontWeight: 800 }}>{t.progress_percent}%</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
