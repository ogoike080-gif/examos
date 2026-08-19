import React, { useEffect, useState } from 'react';
import { Outlet, useNavigate, useLocation, useParams } from 'react-router-dom';
import { useAuthStore } from '../../store';
import { ThemeToggle } from '../../components/ThemeProvider';
import { examAPI, settingsAPI } from '../../utils/api';
import Calculator from './Calculator';
import AIAssistant, { AIButton } from './AIAssistant';

// ── CANDIDATE LAYOUT ─────────────────────────────────────────
export function CandidateLayout() {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();
  const [showCalc, setShowCalc] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);

  const tabs = [
    { path:'/exam',         label:'Exams',    icon:'📝' },
    { path:'/exam/prep',    label:'Study',    icon:'🎓' },
    { path:'/exam/results', label:'Results',  icon:'📊' },
    { path:'/exam/insights',label:'Insights', icon:'🔍' },
    { path:'/exam/billing', label:'Upgrade',  icon:'💎' },
    { path:'/exam/profile', label:'Profile',  icon:'👤' },
  ];

  const isActive = (path) =>
    location.pathname === path || location.pathname.startsWith(path + '/');

  return (
    <div style={{ minHeight:'100dvh', background:'var(--bg-base)', display:'flex', flexDirection:'column' }}>
      <header style={{
        height:56, display:'flex', alignItems:'center', justifyContent:'space-between',
        padding:'0 20px', background:'var(--bg-glass)',
        backdropFilter:'blur(20px)', WebkitBackdropFilter:'blur(20px)',
        borderBottom:'1px solid var(--border)', position:'sticky', top:0, zIndex:50, flexShrink:0,
      }}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <div style={{ width:30, height:30, borderRadius:9, background:'linear-gradient(135deg,var(--brand-dark),var(--brand-light))', display:'flex', alignItems:'center', justifyContent:'center', fontSize:15, fontWeight:900, color:'#fff', boxShadow:'0 2px 10px var(--brand-glow)' }}>E</div>
          <div>
            <div style={{ fontFamily:'var(--font-display)', fontSize:14, fontWeight:800, letterSpacing:'-0.02em', lineHeight:1 }}>ExamOS</div>
            <div style={{ fontSize:10, color:'var(--text-muted)' }}>Student Portal</div>
          </div>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <button onClick={() => setShowCalc(c=>!c)} style={{ width:34, height:34, borderRadius:'var(--r)', border:'1px solid var(--border-md)', background:showCalc?'var(--brand-dim)':'var(--bg-raised)', color:showCalc?'var(--brand-light)':'var(--text-secondary)', cursor:'pointer', fontSize:16, display:'flex', alignItems:'center', justifyContent:'center', transition:'all var(--t-fast)' }} title="Calculator">🧮</button>
          <ThemeToggle size="sm" />
          <button onClick={() => { logout(); navigate('/login'); }} style={{ padding:'6px 12px', borderRadius:'var(--r)', border:'1px solid var(--border)', background:'transparent', color:'var(--text-muted)', cursor:'pointer', fontSize:12, fontFamily:'var(--font-body)', fontWeight:600, transition:'all var(--t-fast)' }} onMouseOver={e=>{e.currentTarget.style.borderColor='var(--danger)';e.currentTarget.style.color='var(--danger)';}} onMouseOut={e=>{e.currentTarget.style.borderColor='var(--border)';e.currentTarget.style.color='var(--text-muted)';}}>Logout</button>
        </div>
      </header>
      <main style={{ flex:1, paddingBottom:72, overflowY:'auto' }}><Outlet /></main>
      <nav style={{ position:'fixed', bottom:0, left:0, right:0, height:64, background:'var(--bg-glass)', backdropFilter:'blur(20px) saturate(180%)', WebkitBackdropFilter:'blur(20px) saturate(180%)', borderTop:'1px solid var(--border-md)', display:'flex', alignItems:'center', justifyContent:'space-around', zIndex:50, paddingBottom:'env(safe-area-inset-bottom)' }}>
        {tabs.map(t => {
          const active = isActive(t.path);
          return (
            <button key={t.path} onClick={() => navigate(t.path)} style={{ flex:1, height:'100%', border:'none', background:'transparent', cursor:'pointer', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:3, color:active?'var(--brand-light)':'var(--text-muted)', fontFamily:'var(--font-body)', fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.04em', transition:'color var(--t-fast)', WebkitTapHighlightColor:'transparent' }}>
              <span style={{ fontSize:20, display:'flex', alignItems:'center', justifyContent:'center', width:32, height:32, borderRadius:10, background:active?'var(--brand-dim)':'transparent', transition:'background var(--t-fast)' }}>{t.icon}</span>
              {t.label}
            </button>
          );
        })}
      </nav>
      {showCalc && <Calculator onClose={() => setShowCalc(false)} />}
      <AIButton onClick={() => setAiOpen(o=>!o)} isOpen={aiOpen} />
      <AIAssistant isOpen={aiOpen} onClose={() => setAiOpen(false)} />
    </div>
  );
}

// ── CANDIDATE DASHBOARD ──────────────────────────────────────
export function CandidateDashboard() {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const [exams, setExams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    load();
    const t = setInterval(() => { load(); setNow(new Date()); }, 30000);
    return () => clearInterval(t);
  }, []);

  const load = async () => {
    try { const res = await examAPI.list(); setExams(res.data.exams || []); }
    catch {} finally { setLoading(false); }
  };

  const firstName = user?.full_name?.split(' ')[0] || 'Student';
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  const visible = exams.filter(e => {
    if (e.status === 'draft') return false;
    if (e.session_status === 'waiting' && ['completed','archived'].includes(e.status)) return false;
    return true;
  });

  const getInfo = (exam) => {
    const scheduled = exam.scheduled_at ? new Date(exam.scheduled_at) : null;
    const isUpcoming = scheduled && scheduled > now;
    if (exam.session_status === 'submitted') {
      const pct = parseFloat(exam.percentage || 0);
      const passed = pct >= 50;
      return { badge:passed?'PASSED':'FAILED', badgeColor:passed?'var(--success-dim)':'var(--danger-dim)', badgeText:passed?'var(--success)':'var(--danger)', action:'View Result →', actionTo:`/exam/result/${exam.session_id}`, score:pct };
    }
    if (exam.status === 'paused') return { badge:'PAUSED', badgeColor:'var(--warning-dim)', badgeText:'var(--warning)', action:null };
    if (exam.status === 'completed') return { badge:'ENDED', badgeColor:'var(--bg-raised)', badgeText:'var(--text-muted)', action:null };
    if (isUpcoming) {
      const diff = scheduled - now;
      const mins = Math.floor(diff / 60000);
      const hrs = Math.floor(mins / 60);
      return { badge:`In ${hrs>0?`${hrs}h ${mins%60}m`:`${mins}m`}`, badgeColor:'var(--info-dim)', badgeText:'var(--info)', action:null };
    }
    if (['active','scheduled'].includes(exam.status)) {
      const resume = exam.session_status === 'active';
      return { badge:resume?'RESUME':'OPEN', badgeColor:resume?'var(--warning-dim)':'var(--success-dim)', badgeText:resume?'var(--warning)':'var(--success)', action:resume?'Continue →':'Start Exam →', actionTo:`/exam/take/${exam.id}` };
    }
    return { badge:exam.status, badgeColor:'var(--bg-raised)', badgeText:'var(--text-muted)', action:null };
  };

  const submitted = visible.filter(e => e.session_status === 'submitted');
  const avgScore = submitted.length ? (submitted.reduce((s,e)=>s+parseFloat(e.percentage||0),0)/submitted.length).toFixed(0) : null;

  return (
    <div style={{ maxWidth:680, margin:'0 auto', padding:'24px 16px' }}>
      <div style={{ marginBottom:24, animation:'fadeInUp 0.4s both' }}>
        <p style={{ fontSize:13, color:'var(--text-muted)', marginBottom:4 }}>{greeting} 👋</p>
        <h1 style={{ fontSize:'1.8rem', marginBottom:0 }}>{firstName}</h1>
        {avgScore && <p style={{ fontSize:13, color:'var(--text-secondary)', marginTop:6 }}>Average score: <strong style={{ color:'var(--brand-light)' }}>{avgScore}%</strong> across {submitted.length} exam{submitted.length!==1?'s':''}</p>}
      </div>

      <div
        onClick={() => navigate('/study')}
        style={{
          display:'flex', alignItems:'center', gap:14, cursor:'pointer',
          background:'linear-gradient(135deg,var(--brand-dark),var(--brand-light))',
          borderRadius:'var(--r-xl)', padding:'16px 20px', marginBottom:24,
          boxShadow:'0 4px 20px var(--brand-glow)', animation:'fadeInUp 0.4s 0.02s both',
          transition:'transform var(--t-fast)',
        }}
        onMouseOver={e=>{e.currentTarget.style.transform='translateY(-1px)';}}
        onMouseOut={e=>{e.currentTarget.style.transform='';}}
      >
        <div style={{ width:44, height:44, borderRadius:12, flexShrink:0, background:'rgba(255,255,255,0.18)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:22 }}>📚</div>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontWeight:800, fontSize:15, color:'#fff' }}>Practice CBT</div>
          <div style={{ fontSize:12, color:'rgba(255,255,255,0.85)', marginTop:2 }}>Free mock tests for JAMB, WAEC, NECO &amp; NABTEB</div>
        </div>
        <div style={{ fontSize:13, fontWeight:700, color:'#fff', flexShrink:0 }}>Start →</div>
      </div>

      {visible.length > 0 && (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:10, marginBottom:24, animation:'fadeInUp 0.4s 0.05s both' }}>
          {[{label:'Total',val:visible.length,icon:'📋',color:'var(--brand-light)'},{label:'Completed',val:submitted.length,icon:'✅',color:'var(--success)'},{label:'Pending',val:visible.filter(e=>e.session_status!=='submitted').length,icon:'⏳',color:'var(--warning)'}].map(s=>(
            <div key={s.label} style={{ background:'var(--bg-surface)', border:'1px solid var(--border)', borderRadius:'var(--r-lg)', padding:'14px 12px', textAlign:'center' }}>
              <div style={{ fontSize:20, marginBottom:4 }}>{s.icon}</div>
              <div style={{ fontFamily:'var(--font-display)', fontSize:22, fontWeight:800, color:s.color, letterSpacing:'-0.03em' }}>{s.val}</div>
              <div style={{ fontSize:10, color:'var(--text-muted)', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.06em', marginTop:2 }}>{s.label}</div>
            </div>
          ))}
        </div>
      )}

      <div style={{ animation:'fadeInUp 0.4s 0.1s both' }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12 }}>
          <h2 style={{ fontSize:'1rem', fontWeight:700 }}>Your Exams</h2>
          <span style={{ fontSize:11, color:'var(--text-muted)' }}>{visible.length} assigned</span>
        </div>
        {loading && [1,2,3].map(i=><div key={i} className="skeleton" style={{ height:88, borderRadius:'var(--r-lg)', marginBottom:10 }}/>)}
        {!loading && visible.length===0 && (
          <div style={{ background:'var(--bg-surface)', border:'1px solid var(--border)', borderRadius:'var(--r-xl)', padding:'48px 24px', textAlign:'center' }}>
            <div style={{ fontSize:48, marginBottom:12 }}>📋</div>
            <h3 style={{ fontSize:'1rem', marginBottom:6 }}>No exams yet</h3>
            <p style={{ fontSize:13, color:'var(--text-muted)' }}>Your teacher will assign exams to you. Check back soon.</p>
          </div>
        )}
        <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
          {visible.map((exam,i)=>{
            const info = getInfo(exam);
            return (
              <div key={exam.id} onClick={()=>info.actionTo&&navigate(info.actionTo)}
                style={{ background:'var(--bg-surface)', border:`1px solid ${info.actionTo?'rgba(99,102,241,0.25)':'var(--border)'}`, borderRadius:'var(--r-xl)', padding:'16px 18px', display:'flex', alignItems:'center', gap:14, transition:'all var(--t-base)', cursor:info.actionTo?'pointer':'default', animation:`fadeInUp 0.4s ${i*0.05+0.15}s both` }}
                onMouseOver={e=>{if(info.actionTo){e.currentTarget.style.transform='translateY(-1px)';e.currentTarget.style.boxShadow='var(--shadow-md)';}}}
                onMouseOut={e=>{e.currentTarget.style.transform='';e.currentTarget.style.boxShadow='';}}
              >
                <div style={{ width:44, height:44, borderRadius:12, flexShrink:0, background:'var(--brand-dim)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:20 }}>📝</div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontWeight:700, fontSize:14, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', marginBottom:3 }}>{exam.title}</div>
                  <div style={{ display:'flex', gap:10, alignItems:'center', flexWrap:'wrap' }}>
                    {exam.subject_name&&<span style={{ fontSize:11, color:'var(--text-muted)' }}>📚 {exam.subject_name}</span>}
                    <span style={{ fontSize:11, color:'var(--text-muted)' }}>⏱ {exam.duration_minutes}m</span>
                    {info.score!==undefined&&<span style={{ fontSize:11, fontWeight:700, color:info.score>=50?'var(--success)':'var(--danger)' }}>{info.score.toFixed(0)}%</span>}
                  </div>
                </div>
                <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:6, flexShrink:0 }}>
                  <span style={{ padding:'3px 9px', borderRadius:'var(--r-full)', fontSize:10, fontWeight:700, letterSpacing:'0.05em', background:info.badgeColor, color:info.badgeText }}>{info.badge}</span>
                  {info.action&&<span style={{ fontSize:12, fontWeight:700, color:'var(--brand-light)' }}>{info.action}</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── RESULTS PAGE ─────────────────────────────────────────────
export function ResultsPage() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const [result, setResult] = useState(null);
  const [settings, setSettings] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      examAPI.results(sessionId),
      settingsAPI.get().catch(() => ({ data:{ settings:{} } })),
    ]).then(([r,s]) => {
      setResult(r.data.result);
      setSettings(s.data.settings || {});
    }).finally(() => setLoading(false));
  }, [sessionId]);

  if (loading) return <div style={{ minHeight:'60vh', display:'flex', alignItems:'center', justifyContent:'center' }}><div className="spinner" style={{ width:28, height:28 }}/></div>;
  if (!result) return <div style={{ padding:40, textAlign:'center', color:'var(--text-muted)' }}><div style={{ fontSize:40, marginBottom:12 }}>⚠️</div><p>Result not found.</p><button className="btn btn-secondary" style={{ marginTop:12 }} onClick={()=>navigate('/exam')}>← Back</button></div>;

  const pct = parseFloat(result.percentage || 0);
  const examTotal = parseFloat(result.exam_total || 100);
  const passMark = parseFloat(result.pass_marks || examTotal * 0.5);
  const passed = pct >= (passMark / examTotal) * 100;
  const themeColor = settings.result_color || '#6366F1';
  const statusColor = passed ? 'var(--success)' : 'var(--danger)';
  const statusBg = passed ? 'var(--success-dim)' : 'var(--danger-dim)';

  function getGrade(p) {
    if (p>=90) return {grade:'A1',remark:'Excellent'};
    if (p>=80) return {grade:'B2',remark:'Very Good'};
    if (p>=75) return {grade:'B3',remark:'Good'};
    if (p>=70) return {grade:'C4',remark:'Credit'};
    if (p>=65) return {grade:'C5',remark:'Credit'};
    if (p>=60) return {grade:'C6',remark:'Credit'};
    if (p>=55) return {grade:'D7',remark:'Pass'};
    if (p>=50) return {grade:'E8',remark:'Pass'};
    return {grade:'F9',remark:'Fail'};
  }
  const { grade, remark } = getGrade(pct);

  return (
    <div style={{ maxWidth:640, margin:'0 auto', padding:'24px 16px 40px' }}>
      <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:24 }}>
        <button className="btn btn-ghost btn-sm" onClick={()=>navigate('/exam')}>← Back</button>
        <h1 style={{ fontSize:'1.3rem', flex:1 }}>Exam Result</h1>
        <button className="btn btn-secondary btn-sm" onClick={()=>navigate(`/exam/result/${sessionId}/review`)}>📖 Review Answers</button>
        <button className="btn btn-secondary btn-sm" onClick={()=>window.print()}>🖨 Print</button>
      </div>

      {/* School header */}
      <div style={{ background:`linear-gradient(135deg,${themeColor}dd,${themeColor})`, borderRadius:'var(--r-xl)', padding:'20px 24px', marginBottom:16, textAlign:'center', color:'#fff' }}>
        <div style={{ fontSize:18, fontWeight:900, fontFamily:'var(--font-display)', marginBottom:4 }}>{settings.school_name||'Ogotech Conventional/Technical School'}</div>
        <div style={{ fontSize:11, opacity:0.85 }}>"{settings.school_motto||'Excellence Through Knowledge and Skills'}"</div>
        <div style={{ fontSize:10, opacity:0.7, marginTop:4, letterSpacing:'0.08em' }}>COMPUTER-BASED TEST RESULT SLIP</div>
      </div>

      {/* Info */}
      <div style={{ background:'var(--bg-surface)', border:'1px solid var(--border)', borderRadius:'var(--r-xl)', padding:'16px 20px', marginBottom:16 }}>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
          {[['Candidate',result.candidate_name||'—'],['Exam',result.title||'—'],['Subject',result.subject_name||'—'],['Reference',sessionId?.slice(0,12).toUpperCase()],['Date',result.submitted_at?new Date(result.submitted_at).toLocaleString('en-NG'):'—'],['Status',result.status?.toUpperCase()||'—']].map(([k,v])=>(
            <div key={k}>
              <div style={{ fontSize:10, fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:3 }}>{k}</div>
              <div style={{ fontSize:13, fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{v}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Pass/Fail */}
      <div style={{ background:statusBg, border:`1.5px solid ${statusColor}`, borderRadius:'var(--r-xl)', padding:'16px 20px', marginBottom:16, display:'flex', alignItems:'center', justifyContent:'space-between' }}>
        <div style={{ display:'flex', alignItems:'center', gap:14 }}>
          <div style={{ width:48, height:48, borderRadius:'50%', background:statusColor, display:'flex', alignItems:'center', justifyContent:'center', fontSize:22, color:'#fff', fontWeight:900, flexShrink:0 }}>{passed?'✓':'✗'}</div>
          <div>
            <div style={{ fontFamily:'var(--font-display)', fontSize:22, fontWeight:900, color:statusColor }}>{passed?'PASSED':'FAILED'}</div>
            <div style={{ fontSize:12, color:'var(--text-secondary)', marginTop:2 }}>{passed?`Congratulations! Above pass mark of ${passMark} marks.`:`Did not reach pass mark of ${passMark} marks. Study harder.`}</div>
          </div>
        </div>
        <div style={{ textAlign:'right', flexShrink:0 }}>
          <div style={{ fontSize:10, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.06em' }}>Pass Mark</div>
          <div style={{ fontFamily:'var(--font-display)', fontSize:20, fontWeight:900 }}>{passMark}/{examTotal}</div>
        </div>
      </div>

      {/* Score cards */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12, marginBottom:16 }}>
        <div style={{ background:'var(--bg-surface)', border:'1px solid var(--border)', borderRadius:'var(--r-xl)', padding:'16px', textAlign:'center' }}>
          <div style={{ fontSize:11, fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:8 }}>Score</div>
          <div style={{ fontFamily:'var(--font-display)', fontSize:28, fontWeight:900, color:themeColor, lineHeight:1 }}>{parseFloat(result.score||0)%1===0?result.score:parseFloat(result.score||0).toFixed(1)}</div>
          <div style={{ fontSize:12, color:'var(--text-muted)', marginTop:4 }}>of {examTotal}</div>
          <div style={{ height:6, background:'var(--bg-overlay)', borderRadius:3, overflow:'hidden', marginTop:10 }}>
            <div style={{ height:'100%', width:`${Math.min(pct,100)}%`, background:themeColor, borderRadius:3 }}/>
          </div>
          <div style={{ fontSize:11, color:'var(--text-muted)', marginTop:4 }}>{pct.toFixed(1)}%</div>
        </div>
        <div style={{ background:'var(--bg-surface)', border:`2px solid ${statusColor}`, borderRadius:'var(--r-xl)', padding:'16px', textAlign:'center' }}>
          <div style={{ fontSize:11, fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:8 }}>Grade</div>
          <div style={{ fontFamily:'var(--font-display)', fontSize:40, fontWeight:900, color:passed?themeColor:'var(--danger)', lineHeight:1 }}>{grade}</div>
          <div style={{ fontSize:12, color:passed?'var(--success)':'var(--danger)', fontWeight:700, marginTop:6 }}>{remark}</div>
          <div style={{ marginTop:8, padding:'3px 12px', borderRadius:'var(--r-full)', background:statusBg, color:statusColor, fontSize:11, fontWeight:700, display:'inline-block' }}>{passed?'✓ PASSED':'✗ FAILED'}</div>
        </div>
        <div style={{ background:'var(--bg-surface)', border:'1px solid var(--border)', borderRadius:'var(--r-xl)', padding:'16px' }}>
          <div style={{ fontSize:11, fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:8 }}>Summary</div>
          {[['Score',`${parseFloat(result.score||0)} marks`],['Max',`${examTotal} marks`],['Pass',`${passMark} marks`],['%',`${pct.toFixed(2)}%`],['Grade',grade]].map(([k,v])=>(
            <div key={k} style={{ display:'flex', justifyContent:'space-between', fontSize:11, padding:'3px 0', borderBottom:'1px solid var(--border)' }}>
              <span style={{ color:'var(--text-muted)' }}>{k}</span>
              <span style={{ fontWeight:700 }}>{v}</span>
            </div>
          ))}
        </div>
      </div>

      {!passed && (
        <div style={{ background:'var(--danger-dim)', border:'1px solid var(--danger)', borderRadius:'var(--r-xl)', padding:'14px 18px', marginBottom:16, display:'flex', gap:12 }}>
          <div style={{ fontSize:24, flexShrink:0 }}>📖</div>
          <div>
            <div style={{ fontWeight:700, color:'var(--danger)', fontSize:13, marginBottom:4 }}>IMPROVEMENT REQUIRED</div>
            <div style={{ fontSize:12, color:'var(--text-secondary)', lineHeight:1.7 }}>You scored <strong>{pct.toFixed(1)}%</strong>, below the required pass mark of <strong>{((passMark/examTotal)*100).toFixed(0)}%</strong>. Review your materials and try again.</div>
          </div>
        </div>
      )}

      <div style={{ background:'var(--bg-surface)', border:'1px solid var(--border)', borderRadius:'var(--r-xl)', padding:'16px 20px', marginBottom:16 }}>
        <div style={{ fontSize:11, fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:10 }}>Teacher's Comment</div>
        <div style={{ fontSize:13, color:'var(--text-secondary)', lineHeight:1.7, borderLeft:'3px solid var(--brand)', paddingLeft:14, fontStyle:'italic' }}>
          "{pct>=90?'Outstanding! Keep aiming high.':pct>=75?'Excellent work! Strong mastery.':pct>=60?'Good performance. Keep working hard.':pct>=50?'Satisfactory. With more effort you will improve.':pct>=40?'Needs more dedication and teacher support.':'Very poor. Must attend extra lessons and study much harder.'}"
        </div>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:16, padding:'16px 0' }}>
        {[['Principal',settings.principal_name],[null,null],['Exam Officer',settings.exam_officer_name]].map(([title,name],i)=>(
          <div key={i} style={{ textAlign:'center' }}>
            {i===1?(
              <div style={{ width:72, height:72, borderRadius:'50%', border:`2px solid ${themeColor}`, margin:'0 auto 8px', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', color:themeColor, fontSize:9, fontWeight:700 }}>
                <div style={{ fontSize:10 }}>OFFICIAL</div><div>RESULT</div><div>{new Date().toLocaleDateString('en-NG',{day:'2-digit',month:'short',year:'numeric'})}</div>
              </div>
            ):<div style={{ borderBottom:'1px solid var(--text-muted)', height:40, marginBottom:6 }}/>}
            {title&&<div style={{ fontSize:11, fontWeight:700 }}>{name||'_______________'}</div>}
            {title&&<div style={{ fontSize:10, color:'var(--text-muted)' }}>{title}</div>}
          </div>
        ))}
      </div>

      <div style={{ textAlign:'center', fontSize:10, color:'var(--text-dim)', marginTop:12 }}>
        REF: {sessionId?.slice(0,16).toUpperCase()} · This result is computer-generated and valid without signature. · ExamOS 2.0
      </div>
    </div>
  );
}

// ── REVIEW ANSWERS (per-question, with explanations) ────────────
export function ReviewPage() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const [items, setItems] = useState(null);
  const [examTitle, setExamTitle] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all'); // all | wrong | correct

  useEffect(() => {
    examAPI.review(sessionId)
      .then(r => { setItems(r.data.items || []); setExamTitle(r.data.exam_title || ''); })
      .catch(err => setError(err.response?.data?.error || 'Could not load review'))
      .finally(() => setLoading(false));
  }, [sessionId]);

  if (loading) return <div style={{ minHeight:'60vh', display:'flex', alignItems:'center', justifyContent:'center' }}><div className="spinner" style={{ width:28, height:28 }}/></div>;
  if (error) return <div style={{ padding:40, textAlign:'center', color:'var(--text-muted)' }}><div style={{ fontSize:40, marginBottom:12 }}>⚠️</div><p>{error}</p><button className="btn btn-secondary" style={{ marginTop:12 }} onClick={()=>navigate(-1)}>← Back</button></div>;

  const wrongCount = items.filter(i => i.is_correct === false).length;
  const visible = items.filter(i => filter === 'all' ? true : filter === 'wrong' ? i.is_correct === false : i.is_correct === true);

  return (
    <div style={{ maxWidth:680, margin:'0 auto', padding:'20px 16px 60px' }}>
      <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:16 }}>
        <button className="btn btn-ghost btn-sm" onClick={()=>navigate(-1)}>← Back</button>
        <h1 style={{ fontSize:'1.2rem', flex:1 }}>Review — {examTitle}</h1>
      </div>

      {wrongCount > 0 && (
        <div style={{ background:'var(--danger-dim)', border:'1px solid var(--danger)', borderRadius:'var(--r-lg)', padding:'12px 16px', marginBottom:16, fontSize:13, color:'var(--text-primary)' }}>
          You missed <strong>{wrongCount}</strong> question{wrongCount!==1?'s':''}. Read the explanation on each one below to see where it went wrong.
        </div>
      )}

      <div style={{ display:'flex', gap:8, marginBottom:16 }}>
        {[['all','All'],['wrong',`Missed (${wrongCount})`],['correct',`Correct (${items.length-wrongCount})`]].map(([key,label]) => (
          <button key={key} onClick={()=>setFilter(key)} style={{
            padding:'6px 14px', borderRadius:'var(--r-full)', fontSize:12.5, fontWeight:700, cursor:'pointer',
            border:`1.5px solid ${filter===key?'var(--brand)':'var(--border-md)'}`,
            background:filter===key?'var(--brand-dim)':'var(--bg-raised)',
            color:filter===key?'var(--brand-light)':'var(--text-secondary)',
          }}>{label}</button>
        ))}
      </div>

      <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
        {visible.map(item => (
          <div key={item.number} style={{
            background:'var(--bg-surface)', border:`1.5px solid ${item.is_correct===false?'var(--danger)':item.is_correct===true?'var(--success)':'var(--border)'}`,
            borderRadius:'var(--r-xl)', padding:'16px 18px',
          }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:10 }}>
              <div style={{ fontSize:13.5, fontWeight:600, flex:1 }}>Q{item.number}. {item.question_text}</div>
              {item.is_correct !== null && (
                <span style={{ flexShrink:0, marginLeft:10, fontSize:11, fontWeight:800, padding:'3px 9px', borderRadius:'var(--r-full)', color:'#fff', background:item.is_correct?'var(--success)':'var(--danger)' }}>
                  {item.is_correct ? '✓ Correct' : '✗ Wrong'}
                </span>
              )}
            </div>

            {item.question_type !== 'essay' && (
              <div style={{ display:'flex', flexDirection:'column', gap:5, marginBottom:10 }}>
                {item.options.map((opt, i) => {
                  const isCandidate = item.candidate_answer && opt.toLowerCase().trim() === item.candidate_answer.toLowerCase().trim();
                  const isCorrectOpt = item.correct_answers.some(ca => ca.toLowerCase().trim() === opt.toLowerCase().trim());
                  return (
                    <div key={i} style={{
                      padding:'7px 11px', borderRadius:'var(--r)', fontSize:12.5,
                      background: isCorrectOpt ? 'var(--success-dim)' : isCandidate ? 'var(--danger-dim)' : 'var(--bg-raised)',
                      border: `1px solid ${isCorrectOpt ? 'var(--success)' : isCandidate ? 'var(--danger)' : 'var(--border)'}`,
                      color: isCorrectOpt || isCandidate ? 'var(--text-primary)' : 'var(--text-secondary)',
                      fontWeight: isCorrectOpt || isCandidate ? 700 : 400,
                    }}>
                      {String.fromCharCode(65+i)}) {opt} {isCorrectOpt && ' ✓'} {isCandidate && !isCorrectOpt && ' (your answer)'}
                    </div>
                  );
                })}
              </div>
            )}

            {item.question_type === 'essay' && (
              <div style={{ fontSize:12.5, background:'var(--bg-raised)', borderRadius:'var(--r)', padding:'10px 12px', marginBottom:10, whiteSpace:'pre-wrap' }}>
                {item.candidate_answer || <em style={{ color:'var(--text-muted)' }}>No answer submitted</em>}
              </div>
            )}

            {item.explanation ? (
              <div style={{ fontSize:12.5, background:'var(--brand-dim)', borderRadius:'var(--r)', padding:'10px 12px', color:'var(--text-secondary)' }}>
                <strong style={{ color:'var(--text-primary)' }}>💡 Explanation: </strong>{item.explanation}
              </div>
            ) : (
              item.is_correct === false && (
                <div style={{ fontSize:12, color:'var(--text-muted)', fontStyle:'italic' }}>No explanation available for this question yet.</div>
              )
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default CandidateLayout;
