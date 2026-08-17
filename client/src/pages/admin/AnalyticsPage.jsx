// ── AnalyticsPage ────────────────────────────────────────────
import React, { useEffect, useState } from 'react';
import { analyticsAPI, examAPI } from '../../utils/api';
import Button from '../../components/shared/Button';

export function AnalyticsPage() {
  const [exams, setExams] = useState([]);
  const [selectedExam, setSelectedExam] = useState('');
  const [data, setData] = useState(null);
  const [dashboard, setDashboard] = useState(null);

  useEffect(() => {
    examAPI.list().then(r => setExams(r.data.exams || []));
    analyticsAPI.dashboard().then(r => setDashboard(r.data));
  }, []);

  useEffect(() => {
    if (selectedExam) analyticsAPI.exam(selectedExam).then(r => setData(r.data));
    else setData(null);
  }, [selectedExam]);

  const bar = (pct, color) => (
    <div style={{ flex:1, height:8, background:'var(--bg-overlay)', borderRadius:4, overflow:'hidden' }}>
      <div style={{ width:`${pct}%`, height:'100%', background:color, borderRadius:4, transition:'width 0.8s' }} />
    </div>
  );

  return (
    <div style={{ padding:'28px 32px' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:24 }}>
        <div>
          <h1 style={{ fontFamily:'var(--font-display)', fontSize:24, fontWeight:800, letterSpacing:'-0.03em' }}>Analytics</h1>
          <p style={{ fontSize:13, color:'var(--text-secondary)', marginTop:3 }}>Performance & integrity reports</p>
        </div>
        <select
          value={selectedExam}
          onChange={e => setSelectedExam(e.target.value)}
          style={{ padding:'8px 12px', borderRadius:8, fontSize:13, minWidth:240 }}
        >
          <option value="">— Select exam for detailed report —</option>
          {exams.map(e => <option key={e.id} value={e.id}>{e.title}</option>)}
        </select>
      </div>

      {/* Platform-wide stats */}
      {dashboard && (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:16, marginBottom:24 }}>
          {[
            { label:'Active Sessions', val:dashboard.stats?.active_sessions, color:'var(--blue)' },
            { label:'Flagged', val:dashboard.stats?.flagged_sessions, color:'var(--red)' },
            { label:'Completed Today', val:dashboard.stats?.completed_today, color:'var(--green)' },
            { label:'Total Questions', val:dashboard.stats?.total_questions?.toLocaleString(), color:'var(--accent)' },
          ].map(s => (
            <div key={s.label} style={{ background:'var(--bg-surface)', border:'1px solid var(--border)', borderRadius:'var(--r-lg)', padding:'18px 20px' }}>
              <div style={{ fontSize:11, fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:8 }}>{s.label}</div>
              <div style={{ fontFamily:'var(--font-display)', fontSize:32, fontWeight:800, color:s.color, letterSpacing:'-0.04em' }}>{s.val ?? 0}</div>
            </div>
          ))}
        </div>
      )}

      {data && (
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:20 }}>
          {/* Score distribution */}
          <div style={{ background:'var(--bg-surface)', border:'1px solid var(--border)', borderRadius:'var(--r-lg)', overflow:'hidden' }}>
            <div style={{ padding:'14px 18px', borderBottom:'1px solid var(--border)' }}>
              <span style={{ fontFamily:'var(--font-display)', fontSize:14, fontWeight:700 }}>Score Distribution</span>
            </div>
            <div style={{ padding:18, display:'flex', flexDirection:'column', gap:10 }}>
              {(data.score_distribution || []).map(d => (
                <div key={d.range} style={{ display:'flex', alignItems:'center', gap:10 }}>
                  <span style={{ width:70, fontSize:12, color:'var(--text-secondary)', textAlign:'right' }}>{d.range}%</span>
                  {bar(Math.min((d.count / (data.summary?.submitted||1)) * 100 * 3, 100), 'var(--accent)')}
                  <span style={{ width:40, fontSize:12, fontFamily:'var(--font-mono)', color:'var(--text-secondary)' }}>{d.count}</span>
                </div>
              ))}
              {!data.score_distribution?.length && (
                <div style={{ textAlign:'center', color:'var(--text-muted)', padding:'20px', fontSize:13 }}>No data yet</div>
              )}
            </div>
          </div>

          {/* Summary */}
          <div style={{ background:'var(--bg-surface)', border:'1px solid var(--border)', borderRadius:'var(--r-lg)', overflow:'hidden' }}>
            <div style={{ padding:'14px 18px', borderBottom:'1px solid var(--border)' }}>
              <span style={{ fontFamily:'var(--font-display)', fontSize:14, fontWeight:700 }}>Exam Summary</span>
            </div>
            <div style={{ padding:18, display:'flex', flexDirection:'column', gap:10 }}>
              {[
                { label:'Total Candidates', val:data.summary?.total_candidates || 0 },
                { label:'Submitted', val:data.summary?.submitted || 0 },
                { label:'Average Score', val:data.summary?.avg_percentage ? `${parseFloat(data.summary.avg_percentage).toFixed(1)}%` : '—' },
                { label:'Pass Rate', val:data.summary?.pass_rate ? `${data.summary.pass_rate}%` : '—' },
                { label:'Disqualified', val:data.summary?.disqualified || 0 },
                { label:'Flagged Sessions', val:data.violations?.flagged_sessions || 0 },
                { label:'Total Violations', val:data.violations?.total_events || 0 },
              ].map(item => (
                <div key={item.label} style={{ display:'flex', justifyContent:'space-between', padding:'8px 0', borderBottom:'1px solid var(--border)', fontSize:13 }}>
                  <span style={{ color:'var(--text-secondary)' }}>{item.label}</span>
                  <strong style={{ color:'var(--text-primary)' }}>{item.val}</strong>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {!data && !selectedExam && (
        <div style={{ padding:60, textAlign:'center', color:'var(--text-muted)', background:'var(--bg-surface)', border:'1px solid var(--border)', borderRadius:'var(--r-lg)', fontSize:14 }}>
          Select an exam above to view detailed analytics
        </div>
      )}
    </div>
  );
}

export default AnalyticsPage;
