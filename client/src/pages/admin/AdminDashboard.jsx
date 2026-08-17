import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { analyticsAPI, examAPI } from '../../utils/api';
import { useAuthStore } from '../../store';

function StatCard({ label, value, sub, icon, color, onClick }) {
  return (
    <div onClick={onClick} style={{
      background:'var(--bg-surface)', border:'1px solid var(--border)',
      borderRadius:'var(--r-xl)', padding:'20px',
      cursor: onClick ? 'pointer' : 'default',
      transition:'all var(--t-base)', position:'relative', overflow:'hidden',
    }}
      onMouseOver={e => { if (onClick) { e.currentTarget.style.transform='translateY(-2px)'; e.currentTarget.style.boxShadow='var(--shadow-md)'; e.currentTarget.style.borderColor='var(--border-md)'; }}}
      onMouseOut={e => { e.currentTarget.style.transform=''; e.currentTarget.style.boxShadow=''; e.currentTarget.style.borderColor='var(--border)'; }}
    >
      <div style={{ position:'absolute', top:-20, right:-20, width:80, height:80, borderRadius:'50%', background:`color-mix(in srgb, ${color} 10%, transparent)`, pointerEvents:'none' }} />
      <div style={{ width:40, height:40, borderRadius:12, background:`color-mix(in srgb, ${color} 15%, transparent)`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:18, marginBottom:12 }}>{icon}</div>
      <div style={{ fontFamily:'var(--font-display)', fontSize:'1.8rem', fontWeight:900, letterSpacing:'-0.04em', color, lineHeight:1, marginBottom:4 }}>{value}</div>
      <div style={{ fontSize:12, fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.07em', marginBottom: sub ? 4 : 0 }}>{label}</div>
      {sub && <div style={{ fontSize:11, color:'var(--text-dim)' }}>{sub}</div>}
    </div>
  );
}

export default function AdminDashboard() {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  const [exams, setExams] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const [statsRes, examsRes] = await Promise.allSettled([
        analyticsAPI.dashboard(),
        examAPI.list(),
      ]);
      if (statsRes.status === 'fulfilled') setStats(statsRes.value.data);
      if (examsRes.status === 'fulfilled') setExams(examsRes.value.data.exams?.slice(0,5) || []);
    } catch {}
    finally { setLoading(false); }
  };

  const firstName = user?.full_name?.split(' ')[0] || 'Admin';
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const activeExams = exams.filter(e => e.status === 'active').length;
  const scheduledExams = exams.filter(e => e.status === 'scheduled').length;
  const statusColors = { active:'var(--success)', scheduled:'var(--info)', completed:'var(--text-muted)', paused:'var(--warning)', draft:'var(--text-dim)' };

  return (
    <div style={{ padding:'24px 28px', maxWidth:1200 }}>
      {/* Header */}
      <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', marginBottom:28, animation:'fadeInUp 0.4s both', flexWrap:'wrap', gap:12 }}>
        <div>
          <p style={{ fontSize:13, color:'var(--text-muted)', marginBottom:4 }}>{greeting} 👋</p>
          <h1 style={{ fontSize:'1.7rem', marginBottom:4 }}>Welcome, {firstName}</h1>
          <p style={{ fontSize:13, color:'var(--text-secondary)' }}>
            {new Date().toLocaleDateString('en-NG', { weekday:'long', day:'numeric', month:'long', year:'numeric' })}
          </p>
        </div>
        <div style={{ display:'flex', gap:10, alignItems:'center', flexWrap:'wrap' }}>
          {activeExams > 0 && (
            <div style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 16px', borderRadius:'var(--r-full)', background:'var(--success-dim)', border:'1px solid var(--success)' }}>
              <span style={{ width:8, height:8, borderRadius:'50%', background:'var(--success)', animation:'pulse 1.5s infinite' }}/>
              <span style={{ fontSize:13, fontWeight:700, color:'var(--success)' }}>{activeExams} Live Now</span>
            </div>
          )}
          <button className="btn btn-primary" onClick={() => navigate('/admin/exams')}>+ New Exam</button>
        </div>
      </div>

      {/* Stats */}
      {loading ? (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(190px,1fr))', gap:14, marginBottom:28 }}>
          {[1,2,3,4].map(i => <div key={i} className="skeleton" style={{ height:130, borderRadius:'var(--r-xl)' }}/>)}
        </div>
      ) : (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(190px,1fr))', gap:14, marginBottom:28, animation:'fadeInUp 0.4s 0.05s both' }}>
          <StatCard label="Students" value={stats?.total_candidates || 0} icon="👥" color="var(--brand-light)" sub="Registered candidates" onClick={() => navigate('/admin/candidates')} />
          <StatCard label="Exams" value={stats?.total_exams || 0} icon="📝" color="var(--info)" sub={`${scheduledExams} scheduled`} onClick={() => navigate('/admin/exams')} />
          <StatCard label="Questions" value={stats?.total_questions || 0} icon="🗂" color="var(--warning)" sub="In question bank" onClick={() => navigate('/admin/questions')} />
          <StatCard label="Submissions" value={stats?.total_sessions || 0} icon="✅" color="var(--success)" sub="Total exam sessions" />
        </div>
      )}

      {/* Grid */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:20, animation:'fadeInUp 0.4s 0.1s both' }}
        className="dash-grid">

        {/* Recent exams */}
        <div style={{ background:'var(--bg-surface)', border:'1px solid var(--border)', borderRadius:'var(--r-xl)', padding:'20px' }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:16 }}>
            <h3 style={{ fontSize:'0.95rem' }}>Recent Exams</h3>
            <button className="btn btn-ghost btn-sm" onClick={() => navigate('/admin/exams')}>View all →</button>
          </div>
          {exams.length === 0 ? (
            <div style={{ textAlign:'center', padding:'32px 0', color:'var(--text-muted)' }}>
              <div style={{ fontSize:32, marginBottom:8 }}>📝</div>
              <p style={{ fontSize:13 }}>No exams yet.</p>
              <button className="btn btn-primary btn-sm" style={{ marginTop:12 }} onClick={() => navigate('/admin/exams')}>Create Exam</button>
            </div>
          ) : exams.map(e => (
            <div key={e.id} onClick={() => navigate('/admin/exams')} style={{ display:'flex', alignItems:'center', gap:12, padding:'11px 0', borderBottom:'1px solid var(--border)', cursor:'pointer', transition:'all var(--t-fast)' }}
              onMouseOver={ev => ev.currentTarget.style.paddingLeft='8px'} onMouseOut={ev => ev.currentTarget.style.paddingLeft='0'}>
              <div style={{ width:34, height:34, borderRadius:9, background:'var(--brand-dim)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:15, flexShrink:0 }}>📝</div>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:13, fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{e.title}</div>
                <div style={{ fontSize:11, color:'var(--text-muted)', marginTop:1 }}>{e.candidate_count||0} candidates · {e.duration_minutes}min</div>
              </div>
              <span style={{ padding:'3px 9px', borderRadius:'var(--r-full)', fontSize:10, fontWeight:700, background:`color-mix(in srgb, ${statusColors[e.status]||'var(--text-muted)'} 12%, transparent)`, color:statusColors[e.status]||'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.05em', whiteSpace:'nowrap' }}>{e.status}</span>
            </div>
          ))}
        </div>

        {/* Quick actions + status */}
        <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
          <div style={{ background:'var(--bg-surface)', border:'1px solid var(--border)', borderRadius:'var(--r-xl)', padding:'20px' }}>
            <h3 style={{ fontSize:'0.95rem', marginBottom:16 }}>Quick Actions</h3>
            <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
              {[
                { label:'Register Candidates', icon:'👤', path:'/admin/candidates', color:'var(--brand)' },
                { label:'Add Questions',       icon:'➕', path:'/admin/questions',  color:'var(--info)' },
                { label:'Import Questions',    icon:'⬆',  path:'/admin/import',     color:'var(--warning)' },
                { label:'Class Results',       icon:'📊', path:'/admin/results',    color:'var(--success)' },
                { label:'Live Monitor',        icon:'📡', path:'/admin/monitor',    color:'var(--danger)' },
              ].map(a => (
                <button key={a.path} onClick={() => navigate(a.path)} style={{
                  display:'flex', alignItems:'center', gap:12, padding:'10px 14px',
                  borderRadius:'var(--r-lg)', border:'1px solid var(--border)',
                  background:'var(--bg-raised)', cursor:'pointer', transition:'all var(--t-fast)', fontFamily:'var(--font-body)',
                }}
                  onMouseOver={e => { e.currentTarget.style.background='var(--bg-overlay)'; e.currentTarget.style.borderColor=a.color; e.currentTarget.style.transform='translateX(4px)'; }}
                  onMouseOut={e => { e.currentTarget.style.background='var(--bg-raised)'; e.currentTarget.style.borderColor='var(--border)'; e.currentTarget.style.transform=''; }}
                >
                  <span style={{ width:32, height:32, borderRadius:9, flexShrink:0, background:`color-mix(in srgb, ${a.color} 15%, transparent)`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:15 }}>{a.icon}</span>
                  <span style={{ fontSize:13, fontWeight:600, color:'var(--text-primary)' }}>{a.label}</span>
                  <span style={{ marginLeft:'auto', color:'var(--text-muted)' }}>→</span>
                </button>
              ))}
            </div>
          </div>

          <div style={{ background:'var(--bg-surface)', border:'1px solid var(--border)', borderRadius:'var(--r-xl)', padding:'20px' }}>
            <h3 style={{ fontSize:'0.95rem', marginBottom:14 }}>System Status</h3>
            {[['Server','Online'],['Database','Connected'],['AI Engine','Active'],['Socket.io','Running']].map(([k,v]) => (
              <div key={k} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'7px 0', borderBottom:'1px solid var(--border)' }}>
                <span style={{ fontSize:13, color:'var(--text-secondary)' }}>{k}</span>
                <span style={{ display:'flex', alignItems:'center', gap:5, fontSize:12, fontWeight:700, color:'var(--success)' }}>
                  <span style={{ width:6, height:6, borderRadius:'50%', background:'var(--success)' }}/>
                  {v}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <style>{`@media(max-width:768px){.dash-grid{grid-template-columns:1fr!important}}`}</style>
    </div>
  );
}
