import React, { useState, useEffect } from 'react';
import axios from 'axios';

const API = '/api';

export default function InsightsPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    axios.get(`${API}/analytics/my-insights`)
      .then(r => setData(r.data))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><div className="spinner" style={{ width: 28, height: 28 }} /></div>;
  }

  if (error || !data) {
    return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>Couldn't load your insights right now.</div>;
  }

  if (!data.hasData) {
    return (
      <div style={{ padding: '60px 24px', textAlign: 'center' }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>🔍</div>
        <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 6 }}>No exam data yet</div>
        <div style={{ color: 'var(--text-secondary)', fontSize: 13.5 }}>Complete a real exam (not just practice) and your weak-topic breakdown will show up here.</div>
      </div>
    );
  }

  return (
    <div style={{ padding: '20px 16px 40px', maxWidth: 640, margin: '0 auto' }}>
      <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '1.4rem', marginBottom: 4 }}>🔍 Mistake Detective</h1>
      <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 20 }}>
        Based on {data.totalExams} exam{data.totalExams !== 1 ? 's' : ''} · average {data.averagePercentage}%
      </p>

      {data.weakestTopics.length > 0 && (
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-xl)', padding: 18, marginBottom: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>You don't have a general problem — you have specific gaps</div>
          <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginBottom: 14 }}>
            You specifically struggle with:
          </div>
          {data.weakestTopics.map((t, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 0', borderBottom: i < data.weakestTopics.length - 1 ? '1px solid var(--border)' : 'none' }}>
              <div>
                <span style={{ fontWeight: 600, fontSize: 13.5 }}>{t.tag}</span>
                <span style={{ fontSize: 11.5, color: 'var(--text-muted)', marginLeft: 8 }}>{t.subject}</span>
              </div>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: t.accuracy < 40 ? 'var(--danger)' : 'var(--warning)' }}>{t.accuracy}%</span>
            </div>
          ))}
        </div>
      )}

      {data.strongestTopics.length > 0 && (
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-xl)', padding: 18, marginBottom: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>💪 Where you're strong</div>
          {data.strongestTopics.map((t, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 0', borderBottom: i < data.strongestTopics.length - 1 ? '1px solid var(--border)' : 'none' }}>
              <div>
                <span style={{ fontWeight: 600, fontSize: 13.5 }}>{t.tag}</span>
                <span style={{ fontSize: 11.5, color: 'var(--text-muted)', marginLeft: 8 }}>{t.subject}</span>
              </div>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--success)' }}>{t.accuracy}%</span>
            </div>
          ))}
        </div>
      )}

      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-xl)', padding: 18 }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>By Subject</div>
        {data.subjects.map((s, i) => (
          <div key={i} style={{ marginBottom: i < data.subjects.length - 1 ? 12 : 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 4 }}>
              <span style={{ fontWeight: 600 }}>{s.name}</span>
              <span style={{ color: 'var(--text-muted)' }}>{s.correct}/{s.total} · {s.accuracy}%</span>
            </div>
            <div style={{ height: 6, background: 'var(--bg-raised)', borderRadius: 'var(--r-full)', overflow: 'hidden' }}>
              <div style={{ width: `${s.accuracy}%`, height: '100%', background: s.accuracy >= 70 ? 'var(--success)' : s.accuracy >= 40 ? 'var(--warning)' : 'var(--danger)', borderRadius: 'var(--r-full)' }} />
            </div>
          </div>
        ))}
      </div>

      {data.weakestTopics.length === 0 && (
        <div style={{ marginTop: 16, padding: 18, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12.5 }}>
          Not enough repeated-topic data yet to spot patterns — keep taking exams and this will sharpen up.
        </div>
      )}
    </div>
  );
}
