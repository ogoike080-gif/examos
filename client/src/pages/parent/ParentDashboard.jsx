import React, { useState, useEffect } from 'react';
import axios from 'axios';

const API = '/api';

export default function ParentDashboard() {
  const [children, setChildren] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);

  useEffect(() => {
    axios.get(`${API}/parent/children`)
      .then(r => {
        setChildren(r.data.children || []);
        if (r.data.children?.length) setSelectedId(r.data.children[0].id);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><div className="spinner" style={{ width: 28, height: 28 }} /></div>;
  }

  if (children.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 24px' }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>👨‍👩‍👧</div>
        <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 6 }}>No students linked yet</div>
        <div style={{ color: 'var(--text-secondary)', fontSize: 13.5 }}>Ask your school's admin to link your account to your child's profile.</div>
      </div>
    );
  }

  return (
    <div>
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '1.4rem', marginBottom: 16 }}>Your Children</h1>

      {children.length > 1 && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
          {children.map(c => (
            <button key={c.id} onClick={() => setSelectedId(c.id)} style={{
              padding: '8px 16px', borderRadius: 'var(--r-full)',
              border: `1.5px solid ${selectedId === c.id ? 'var(--brand)' : 'var(--border-md)'}`,
              background: selectedId === c.id ? 'var(--brand-dim)' : 'var(--bg-raised)',
              color: selectedId === c.id ? 'var(--brand-light)' : 'var(--text-secondary)',
              fontWeight: 700, fontSize: 13, cursor: 'pointer',
            }}>{c.full_name}</button>
          ))}
        </div>
      )}

      {selectedId && <ChildReport candidateId={selectedId} />}
    </div>
  );
}

function ChildReport({ candidateId }) {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    axios.get(`${API}/parent/children/${candidateId}/report`)
      .then(r => setReport(r.data))
      .finally(() => setLoading(false));
  }, [candidateId]);

  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><div className="spinner" style={{ width: 24, height: 24 }} /></div>;
  if (!report) return null;

  const { student, insights } = report;

  if (!insights.hasData) {
    return (
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-xl)', padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>
        {student.full_name} hasn't completed any exams yet.
      </div>
    );
  }

  return (
    <div>
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-xl)', padding: 20, marginBottom: 16, display: 'flex', gap: 24, flexWrap: 'wrap' }}>
        <Stat label="Exams Taken" value={insights.totalExams} />
        <Stat label="Average Score" value={`${insights.averagePercentage}%`} />
        <Stat label="Class" value={student.class_name || '—'} />
      </div>

      {insights.weakestTopics.length > 0 && (
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-xl)', padding: 18, marginBottom: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>⚠ Areas needing attention</div>
          {insights.weakestTopics.map((t, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: i < insights.weakestTopics.length - 1 ? '1px solid var(--border)' : 'none', fontSize: 13 }}>
              <span>{t.tag} <span style={{ color: 'var(--text-muted)', fontSize: 11.5 }}>({t.subject})</span></span>
              <span style={{ fontWeight: 700, color: t.accuracy < 40 ? 'var(--danger)' : 'var(--warning)' }}>{t.accuracy}%</span>
            </div>
          ))}
        </div>
      )}

      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-xl)', padding: 18, marginBottom: 16 }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>By Subject</div>
        {insights.subjects.map((s, i) => (
          <div key={i} style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 4 }}>
              <span style={{ fontWeight: 600 }}>{s.name}</span>
              <span style={{ color: 'var(--text-muted)' }}>{s.accuracy}%</span>
            </div>
            <div style={{ height: 6, background: 'var(--bg-raised)', borderRadius: 'var(--r-full)', overflow: 'hidden' }}>
              <div style={{ width: `${s.accuracy}%`, height: '100%', background: s.accuracy >= 70 ? 'var(--success)' : s.accuracy >= 40 ? 'var(--warning)' : 'var(--danger)' }} />
            </div>
          </div>
        ))}
      </div>

      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-xl)', padding: 18 }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>Recent Exams</div>
        {insights.recentSessions.map((s, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: i < insights.recentSessions.length - 1 ? '1px solid var(--border)' : 'none', fontSize: 13 }}>
            <span>{s.exam_title}</span>
            <span style={{ fontWeight: 700 }}>{Math.round(s.percentage)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div>
      <div style={{ fontSize: 20, fontWeight: 800 }}>{value}</div>
      <div style={{ fontSize: 11.5, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
    </div>
  );
}
