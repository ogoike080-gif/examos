import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import { ThemeToggle } from '../components/ThemeProvider';
import Calculator from './candidate/Calculator';
import MathText from '../components/MathText';
import ExplanationBox from '../components/ExplanationBox';
import { usePaystack, isRealEmail } from './candidate/PaystackPayment';
import { useAuthStore } from '../store';
import { syllabusAPI, subjectAPI } from '../utils/api';

const API = '/api';
const LETTERS = ['A','B','C','D','E'];

// Only used as a fallback if the live exam_bodies fetch fails — see
// SetupScreen below, which normally loads this from the server so
// admin-added exam bodies (e.g. a university's own entrance exam) show up
// here without a code change. Icons/colors here double as the lookup table
// for exam bodies that don't come with their own from the server.
const FALLBACK_EXAM_TYPES = [
  { id:'WAEC',     label:'WAEC',      icon:'📗', color:'#16A34A' },
  { id:'JAMB',     label:'JAMB/UTME', icon:'📘', color:'#2563EB' },
  { id:'NECO',     label:'NECO',      icon:'📙', color:'#D97706' },
  { id:'NABTEB',   label:'NABTEB',    icon:'📕', color:'#DC2626' },
  { id:'POST_UTME',label:'Post UTME', icon:'🏛',  color:'#7C3AED' },
  { id:'CUSTOM',   label:'Practice',  icon:'✏️',  color:'#6366F1' },
];
const EXTRA_ICON_COLORS = [
  { icon:'🏫', color:'#0891B2' }, { icon:'🎓', color:'#DB2777' },
  { icon:'📚', color:'#65A30D' }, { icon:'🏛️', color:'#EA580C' },
];

// Only used as a fallback if the live subjects fetch fails — see
// SetupScreen below, which normally loads this list from the server so
// admin-added subjects (e.g. a university's own "GS COURSE 101" or
// "MATHS101") show up here without a code change.
const FALLBACK_SUBJECTS = [
  'Mathematics','English Language','Physics','Chemistry','Biology',
  'Economics','Government','Literature in English','Geography',
  'Computer Studies','Accounting','Agricultural Science',
  'Civic Education','Commerce','Financial Accounting',
  'Further Mathematics','Technical Drawing',
];

const TOPICS = {
  'Mathematics': ['Algebra','Calculus','Statistics','Geometry','Trigonometry','Number Theory','Mensuration','All Topics'],
  'English Language': ['Comprehension','Summary','Grammar','Lexis & Structure','All Topics'],
  'Physics': ['Mechanics','Waves','Electricity','Modern Physics','Heat','All Topics'],
  'Chemistry': ['Organic','Inorganic','Physical Chemistry','Electrochemistry','All Topics'],
  'Biology': ['Cell Biology','Genetics','Ecology','Physiology','All Topics'],
  'default': ['All Topics'],
};

const YEARS = ['All', ...Array.from({ length: 8 }, (_, i) => new Date().getFullYear() - i)];
const PAPER_TYPES = [
  { id: 'Any', label: 'Any Paper' },
  { id: 'objective', label: 'Objective' },
  { id: 'theory', label: 'Theory' },
  { id: 'essay', label: 'Essay' },
  { id: 'practical', label: 'Practical' },
];

function formatTime(s) {
  const h = Math.floor(s/3600), m = Math.floor((s%3600)/60), sec = s%60;
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
}

function safeParseArray(v) {
  if (Array.isArray(v)) return v;
  if (!v) return [];
  try { const p = JSON.parse(v); return Array.isArray(p)?p:[]; } catch { return []; }
}

// ── SETUP SCREEN ─────────────────────────────────────────────
function SetupScreen({ onStart }) {
  const [searchParams] = useSearchParams();
  const [examType,  setExamType]  = useState('WAEC');
  const [subject,   setSubject]   = useState(searchParams.get('subject') || 'Mathematics');
  const [topic,     setTopic]     = useState('All Topics');
  const [year,      setYear]      = useState('All');
  const [paperType, setPaperType] = useState('Any');
  const [count,     setCount]     = useState(40);
  const [duration,  setDuration]  = useState(60);
  const [mode,      setMode]      = useState('practice'); // practice | exam | speed
  const [shuffle,   setShuffle]   = useState(true);
  const [showInstr, setShowInstr] = useState(false);

  const subjectTopics = TOPICS[subject] || TOPICS['default'];

  // Was a fixed list — an exam body added in the admin's Exam Body Manager
  // (a university's own entrance exam, for instance) had no way to show up
  // here since this page never asked the server what exists. Now it reads
  // from the same exam_bodies table Exam Body Manager and the Import page's
  // dropdown already use — add one there and it appears here automatically.
  const [examTypes, setExamTypes] = useState(FALLBACK_EXAM_TYPES);
  useEffect(() => {
    syllabusAPI.examBodies()
      .then(r => {
        const bodies = (r.data.exam_bodies || []).filter(b => b.code);
        if (!bodies.length) return; // keep the fallback list as-is
        const known = new Map(FALLBACK_EXAM_TYPES.map(e => [e.id, e]));
        const mapped = bodies.map((b, i) => known.get(b.code) || {
          id: b.code, label: b.name || b.code,
          icon: EXTRA_ICON_COLORS[i % EXTRA_ICON_COLORS.length].icon,
          color: EXTRA_ICON_COLORS[i % EXTRA_ICON_COLORS.length].color,
        });
        // "Practice" (CUSTOM — general practice, not tied to one exam body)
        // is a client-side concept, not a real exam_bodies row — always
        // keep it available alongside whatever the admin has added.
        setExamTypes([...mapped, known.get('CUSTOM')]);
      })
      .catch(() => {}); // keep the fallback list on any failure
  }, []);

  // Same fix, same reason — subjects only ever came from a hardcoded list
  // here, so a subject the admin added specifically for a university course
  // (see the Subjects admin page) had no path to ever appear as an option.
  const [subjectList, setSubjectList] = useState(FALLBACK_SUBJECTS);
  useEffect(() => {
    subjectAPI.list()
      .then(r => {
        const names = (r.data.subjects || []).map(s => s.name).filter(Boolean);
        if (names.length) setSubjectList(names);
      })
      .catch(() => {}); // keep the fallback list on any failure
  }, []);

  const handleStart = () => {
    onStart({ examType, subject, topic, year, paperType, count, duration, mode, shuffle });
  };

  const labelS = { fontSize:11, fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:6, display:'block' };
  const cardS  = { background:'var(--bg-surface)', border:'1px solid var(--border)', borderRadius:'var(--r-xl)', padding:'20px' };

  return (
    <div style={{ minHeight:'100dvh', background:'var(--bg-base)' }}>
      {/* Header */}
      <header style={{ height:56, display:'flex', alignItems:'center', justifyContent:'space-between', padding:'0 24px', background:'var(--bg-glass)', backdropFilter:'blur(20px)', WebkitBackdropFilter:'blur(20px)', borderBottom:'1px solid var(--border)', position:'sticky', top:0, zIndex:50 }}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <div style={{ width:30, height:30, borderRadius:9, background:'linear-gradient(135deg,var(--brand-dark),var(--brand-light))', display:'flex', alignItems:'center', justifyContent:'center', fontSize:15, fontWeight:900, color:'#fff' }}>E</div>
          <span style={{ fontFamily:'var(--font-display)', fontSize:15, fontWeight:800 }}>ExamOS</span>
          <span style={{ fontSize:11, padding:'2px 8px', borderRadius:'var(--r-full)', background:'var(--success-dim)', color:'var(--success)', fontWeight:700 }}>Practice Mode</span>
        </div>
        <ThemeToggle size="sm" />
      </header>

      <div style={{ maxWidth:780, margin:'0 auto', padding:'32px 16px 60px' }}>
        <div style={{ marginBottom:28 }}>
          <h1 style={{ fontSize:'1.7rem', marginBottom:6 }}>Practice Setup</h1>
          <p style={{ fontSize:14, color:'var(--text-muted)' }}>Configure your practice session below</p>
        </div>

        <div style={{ display:'flex', flexDirection:'column', gap:16 }}>

          {/* Exam type */}
          <div style={cardS}>
            <label style={labelS}>Exam Type</label>
            <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
              {examTypes.map(e => (
                <button key={e.id} onClick={() => setExamType(e.id)} style={{
                  display:'flex', alignItems:'center', gap:8, padding:'8px 16px',
                  borderRadius:'var(--r-lg)', border:`1.5px solid ${examType===e.id ? e.color : 'var(--border)'}`,
                  background: examType===e.id ? `color-mix(in srgb,${e.color} 12%,transparent)` : 'var(--bg-raised)',
                  color: examType===e.id ? e.color : 'var(--text-secondary)',
                  cursor:'pointer', fontFamily:'var(--font-body)', fontSize:13, fontWeight:700,
                  transition:'all var(--t-fast)',
                }}>
                  <span>{e.icon}</span>{e.label}
                </button>
              ))}
            </div>
          </div>

          {/* Subject + Topic */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
            <div style={cardS}>
              <label style={labelS}>Subject</label>
              <select value={subject} onChange={e => { setSubject(e.target.value); setTopic('All Topics'); }}
                style={{ width:'100%', padding:'10px 12px', borderRadius:'var(--r)', border:'1.5px solid var(--border-md)', background:'var(--bg-raised)', color:'var(--text-primary)', fontFamily:'var(--font-body)', fontSize:14, cursor:'pointer' }}>
                {subjectList.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div style={cardS}>
              <label style={labelS}>Topic</label>
              <select value={topic} onChange={e => setTopic(e.target.value)}
                style={{ width:'100%', padding:'10px 12px', borderRadius:'var(--r)', border:'1.5px solid var(--border-md)', background:'var(--bg-raised)', color:'var(--text-primary)', fontFamily:'var(--font-body)', fontSize:14, cursor:'pointer' }}>
                {subjectTopics.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>

          {/* Year + Paper Type — narrows within an exam body/subject to a specific
              past-paper year and section, using the structured import pipeline's
              exam_body/paper_type/tags fields. */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
            <div style={cardS}>
              <label style={labelS}>Year</label>
              <select value={year} onChange={e => setYear(e.target.value)}
                style={{ width:'100%', padding:'10px 12px', borderRadius:'var(--r)', border:'1.5px solid var(--border-md)', background:'var(--bg-raised)', color:'var(--text-primary)', fontFamily:'var(--font-body)', fontSize:14, cursor:'pointer' }}>
                {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            <div style={cardS}>
              <label style={labelS}>Paper Type</label>
              <select value={paperType} onChange={e => setPaperType(e.target.value)}
                style={{ width:'100%', padding:'10px 12px', borderRadius:'var(--r)', border:'1.5px solid var(--border-md)', background:'var(--bg-raised)', color:'var(--text-primary)', fontFamily:'var(--font-body)', fontSize:14, cursor:'pointer' }}>
                {PAPER_TYPES.map(p => {
                  // Exam mode and Speed Test are auto-graded and timed — theory/
                  // essay questions have no single right/wrong answer to grade
                  // against, so they're only offered in Practice mode.
                  const disabled = mode !== 'practice' && (p.id === 'theory' || p.id === 'essay');
                  return <option key={p.id} value={p.id} disabled={disabled}>{p.label}{disabled ? ' (Practice only)' : ''}</option>;
                })}
              </select>
            </div>
          </div>

          {/* Count + Duration */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
            <div style={cardS}>
              <label style={labelS}>Number of Questions</label>
              <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
                {[10,20,40,60,80,100].map(n => (
                  <button key={n} onClick={() => setCount(n)} style={{
                    padding:'7px 16px', borderRadius:'var(--r)',
                    border:`1.5px solid ${count===n ? 'var(--brand)' : 'var(--border)'}`,
                    background: count===n ? 'var(--brand-dim)' : 'var(--bg-raised)',
                    color: count===n ? 'var(--brand-light)' : 'var(--text-secondary)',
                    fontFamily:'var(--font-mono)', fontSize:14, fontWeight:700, cursor:'pointer',
                    transition:'all var(--t-fast)',
                  }}>{n}</button>
                ))}
              </div>
            </div>
            <div style={cardS}>
              <label style={labelS}>Duration (minutes)</label>
              <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
                {[15,30,60,90,120,180].map(d => (
                  <button key={d} onClick={() => setDuration(d)} style={{
                    padding:'7px 16px', borderRadius:'var(--r)',
                    border:`1.5px solid ${duration===d ? 'var(--brand)' : 'var(--border)'}`,
                    background: duration===d ? 'var(--brand-dim)' : 'var(--bg-raised)',
                    color: duration===d ? 'var(--brand-light)' : 'var(--text-secondary)',
                    fontFamily:'var(--font-mono)', fontSize:14, fontWeight:700, cursor:'pointer',
                    transition:'all var(--t-fast)',
                  }}>{d}</button>
                ))}
              </div>
            </div>
          </div>

          {/* Mode + Shuffle */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
            <div style={cardS}>
              <label style={labelS}>Mode</label>
              <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                {[
                  { id:'practice', icon:'✏️',  label:'Practice',   desc:'See answers after each question' },
                  { id:'exam',     icon:'📝', label:'Exam',       desc:'Review answers at the end only' },
                  { id:'speed',    icon:'⚡', label:'Speed Test', desc:'Race against time, no review' },
                ].map(m => (
                  <button key={m.id} onClick={() => {
                    setMode(m.id);
                    // Exam/Speed are objective-only — if a theory/essay paper
                    // was selected, fall back to "Any" rather than silently
                    // fetching zero questions or a mode mismatch.
                    if (m.id !== 'practice' && (paperType === 'theory' || paperType === 'essay')) {
                      setPaperType('Any');
                    }
                  }} style={{
                    display:'flex', alignItems:'center', gap:12, padding:'10px 14px',
                    borderRadius:'var(--r-lg)', border:`1.5px solid ${mode===m.id ? 'var(--brand)' : 'var(--border)'}`,
                    background: mode===m.id ? 'var(--brand-dim)' : 'var(--bg-raised)',
                    cursor:'pointer', fontFamily:'var(--font-body)', textAlign:'left',
                    transition:'all var(--t-fast)',
                  }}>
                    <span style={{ fontSize:18 }}>{m.icon}</span>
                    <div>
                      <div style={{ fontSize:13, fontWeight:700, color: mode===m.id ? 'var(--brand-light)' : 'var(--text-primary)' }}>{m.label}</div>
                      <div style={{ fontSize:11, color:'var(--text-muted)' }}>{m.desc}</div>
                    </div>
                    {mode===m.id && <span style={{ marginLeft:'auto', color:'var(--brand-light)', fontSize:16 }}>✓</span>}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
              <div style={cardS}>
                <label style={labelS}>Options</label>
                <label style={{ display:'flex', alignItems:'center', gap:10, cursor:'pointer', padding:'8px 0' }}>
                  <div onClick={() => setShuffle(s=>!s)} style={{
                    width:40, height:22, borderRadius:11,
                    background: shuffle ? 'var(--brand)' : 'var(--bg-overlay)',
                    position:'relative', transition:'background var(--t-fast)', cursor:'pointer', flexShrink:0,
                  }}>
                    <div style={{ position:'absolute', top:2, left: shuffle ? 20 : 2, width:18, height:18, borderRadius:'50%', background:'#fff', transition:'left var(--t-fast)', boxShadow:'0 1px 4px rgba(0,0,0,0.2)' }}/>
                  </div>
                  <div>
                    <div style={{ fontSize:13, fontWeight:600 }}>Shuffle Questions</div>
                    <div style={{ fontSize:11, color:'var(--text-muted)' }}>Randomize question order</div>
                  </div>
                </label>
              </div>

              <div style={{ ...cardS, flex:1 }}>
                <label style={labelS}>Summary</label>
                <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                  {[
                    ['Exam',      examType],
                    ['Subject',   subject],
                    ['Topic',     topic],
                    ['Year',      year],
                    ['Paper',     PAPER_TYPES.find(p => p.id === paperType)?.label || paperType],
                    ['Questions', count],
                    ['Duration',  `${duration} min`],
                    ['Mode',      mode.charAt(0).toUpperCase()+mode.slice(1)],
                  ].map(([k,v]) => (
                    <div key={k} style={{ display:'flex', justifyContent:'space-between', fontSize:12, padding:'4px 0', borderBottom:'1px solid var(--border)' }}>
                      <span style={{ color:'var(--text-muted)' }}>{k}</span>
                      <span style={{ fontWeight:700, color:'var(--text-primary)' }}>{v}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Instructions */}
          <div style={{ ...cardS, border:'1px solid rgba(99,102,241,0.2)', background:'var(--brand-dim)' }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', cursor:'pointer' }} onClick={() => setShowInstr(s=>!s)}>
              <div style={{ fontSize:13, fontWeight:700, color:'var(--brand-light)' }}>📋 Instructions</div>
              <span style={{ color:'var(--brand-light)', transition:'transform var(--t-fast)', transform: showInstr ? 'rotate(180deg)' : 'none' }}>▼</span>
            </div>
            {showInstr && (
              <div style={{ marginTop:12, fontSize:12, color:'var(--text-secondary)', lineHeight:1.8 }}>
                <ul style={{ paddingLeft:18 }}>
                  <li>Read each question carefully before selecting your answer.</li>
                  <li>In <strong>Practice mode</strong>, you can see the correct answer immediately.</li>
                  <li>In <strong>Exam mode</strong>, review all answers at the end.</li>
                  <li>Use the question palette to jump between questions.</li>
                  <li>Flag questions you want to revisit using the ⚑ button.</li>
                  <li>The timer counts down automatically. Submit before it reaches zero.</li>
                  <li>Your score and performance analysis will be shown at the end.</li>
                </ul>
              </div>
            )}
          </div>

          {/* Start button */}
          <button onClick={handleStart} className="btn btn-primary" style={{ width:'100%', padding:16, fontSize:16, fontWeight:800, borderRadius:'var(--r-xl)', justifyContent:'center', gap:10 }}>
            🚀 Start {mode.charAt(0).toUpperCase()+mode.slice(1)} Session ({count} questions · {duration} min)
          </button>
        </div>
      </div>
    </div>
  );
}

// ── PRACTICE ENGINE ───────────────────────────────────────────
// Shown automatically the moment a free-trial candidate finishes their 5th
// (last free) question — not a redirect, an overlay right on top of where
// they already are, since the whole point is to catch them at the exact
// moment they'd want to keep going. Reuses the same Paystack flow and
// placeholder-email handling as the full billing page (PaystackPayment.jsx)
// so a candidate who logged in by name only (no real email on file) still
// gets prompted for one here, inline, instead of hitting a Paystack error.
export function FreeTrialPaywall({ onDismiss }) {
  const { user } = useAuthStore();
  const { pay } = usePaystack();
  // Two very different visitors land here now that "Practice Free" doesn't
  // require login first:
  //  - An anonymous visitor with no account at all — needs a name AND email
  //    before anything else, since Paystack checkout needs both. The
  //    account itself only gets created once payment is actually confirmed
  //    (see routes/payments.js finalizePayment) — not here, and not before
  //    checkout opens. That way someone who backs out of the Paystack popup
  //    doesn't end up with a stray, subscription-less account; entering
  //    these details and completing payment together *is* their signup.
  //  - A logged-in candidate who signed in by name only (no real email on
  //    file — see routes/candidates.js) — already has an account, just
  //    needs an email for Paystack to send the receipt to.
  const isAnonymous = !user;
  const needsEmail = !isRealEmail(user?.email);
  const [name, setName] = useState('');
  const [email, setEmail] = useState(needsEmail ? '' : user?.email || '');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubscribe = async () => {
    if (isAnonymous && !name.trim()) { setError('Enter your name first'); return; }
    if (!isRealEmail(email)) { setError('Enter a valid email — Paystack sends your receipt there'); return; }
    setLoading(true);
    try {
      await pay({
        email,
        full_name: isAnonymous ? name.trim() : undefined,
        amount: 500,
        metadata: { plan_id: 'student', plan_name: 'Student' },
        onSuccess: (data) => {
          // Confirmed — if this was an anonymous checkout, the account was
          // just created server-side and new_session logs them straight in
          // with it, so they land back in their practice session already
          // signed in and subscribed, no separate login step.
          if (data.new_session) {
            axios.defaults.headers.common['Authorization'] = `Bearer ${data.new_session.token}`;
            useAuthStore.setState({ user: data.new_session.user, token: data.new_session.token, isAuthenticated: true });
          }
          window.location.reload();
        },
        onClose: () => setLoading(false),
      });
    } catch (err) {
      setError(err.response?.data?.error || 'Something went wrong — try again');
      setLoading(false);
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)', padding: 16,
    }}>
      <div style={{
        width: '100%', maxWidth: 400, background: 'var(--bg-surface)', border: '1px solid var(--border)',
        borderRadius: 'var(--r-2xl)', padding: '28px 24px', textAlign: 'center', animation: 'fadeIn 0.25s both',
      }}>
        <div style={{ fontSize: 40, marginBottom: 10 }}>🎓</div>
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.3rem', fontWeight: 800, marginBottom: 6 }}>
          That's your 5 free questions!
        </h2>
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20, lineHeight: 1.6 }}>
          Subscribe to keep practicing with unlimited questions, unlimited exams, and full explanations.
        </p>

        {isAnonymous && (
          <div style={{ textAlign: 'left', marginBottom: 12 }}>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>
              Your Name
            </label>
            <input
              type="text"
              value={name}
              onChange={e => { setName(e.target.value); setError(''); }}
              placeholder="e.g. Chidinma Okonkwo"
              style={{ width: '100%', padding: '10px 12px', borderRadius: 'var(--r)', border: '1.5px solid var(--border-md)', background: 'var(--bg-raised)', color: 'var(--text-primary)', fontSize: 14 }}
            />
          </div>
        )}

        <div style={{ textAlign: 'left', marginBottom: 16 }}>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>
            {isAnonymous ? 'Your Email' : 'Email for your receipt'}
          </label>
          <input
            type="email"
            value={email}
            onChange={e => { setEmail(e.target.value); setError(''); }}
            placeholder="you@example.com"
            style={{ width: '100%', padding: '10px 12px', borderRadius: 'var(--r)', border: `1.5px solid ${error ? 'var(--danger)' : 'var(--border-md)'}`, background: 'var(--bg-raised)', color: 'var(--text-primary)', fontSize: 14 }}
          />
          {error && <p style={{ fontSize: 12, color: 'var(--danger)', marginTop: 6 }}>{error}</p>}
        </div>

        <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', marginBottom: 10 }}
          onClick={handleSubscribe} disabled={loading}>
          {loading ? 'Opening checkout…' : 'Subscribe — ₦500/month'}
        </button>
        <button onClick={onDismiss} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 13, cursor: 'pointer', padding: 8 }}>
          Not right now
        </button>
      </div>
    </div>
  );
}

function PracticeEngine({ config, onFinish }) {
  const [questions,  setQuestions]  = useState([]);
  const [answers,    setAnswers]    = useState({});
  const [revealed,   setRevealed]   = useState({});
  const [current,    setCurrent]    = useState(0);
  const [flagged,    setFlagged]    = useState(new Set());
  const [timeLeft,   setTimeLeft]   = useState(config.duration * 60);
  const [loading,    setLoading]    = useState(true);
  const [showPalette,setShowPalette]= useState(false);
  const [showCalc,   setShowCalc]   = useState(false);
  const [done,       setDone]       = useState(false);
  // Set from the questions fetch when this candidate is on the free trial —
  // { remaining } is what's left AFTER this batch was served, so
  // remaining===0 means these are the last free questions they have.
  const [freeTrial,  setFreeTrial]  = useState(null);
  const [showPaywall,setShowPaywall]= useState(false);
  const timerRef = useRef(null);

  useEffect(() => { loadQuestions(); }, []);

  // Free trial ran out with this batch. Two triggers, so this can't be
  // slipped past:
  //  1. The moment they reach the last question AND reveal its answer, pop
  //     the paywall after a short beat so they get to read the explanation
  //     first, rather than yanking it away the instant they answer.
  //  2. If they SKIP that last question instead of answering it (revealed
  //     never becomes true) and try to finish the session anyway, the
  //     paywall still has to appear — handleFinish (below) checks for this
  //     directly rather than relying solely on this effect, since a skipped
  //     question means this effect's condition is never met.
  useEffect(() => {
    if (!freeTrial || freeTrial.remaining > 0) return;
    if (!questions.length) return;
    const lastQ = questions[questions.length - 1];
    if (current !== questions.length - 1 || !revealed[lastQ?.id]) return;
    const t = setTimeout(() => setShowPaywall(true), 2500);
    return () => clearTimeout(t);
  }, [current, revealed, freeTrial, questions]);

  useEffect(() => {
    if (loading || done) return;
    timerRef.current = setInterval(() => {
      setTimeLeft(t => {
        if (t <= 1) { clearInterval(timerRef.current); handleFinish(true); return 0; }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, [loading, done]);

  const loadQuestions = async () => {
    try {
      const params = {
        subject: config.subject,
        limit: config.count,
        ...(config.topic !== 'All Topics' ? { topic: config.topic } : {}),
        ...(config.examType !== 'CUSTOM' ? { exam_type: config.examType } : {}),
        ...(config.year && config.year !== 'All' ? { year: config.year } : {}),
        ...(config.paperType && config.paperType !== 'Any' ? { paper_type: config.paperType } : {}),
      };
      const res = await axios.get(`${API}/questions`, { params });
      let qs = res.data.questions || [];
      qs = qs.map(q => ({ ...q, options: safeParseArray(q.options) }));
      // Belt-and-braces: Exam/Speed mode is objective-only (see ExamBuilderPage
      // and routes/exams.js for the same rule on admin-built exams). This
      // self-serve practice picker queries questions directly, so filter here
      // too rather than relying solely on the Paper Type dropdown upstream.
      if (config.mode !== 'practice') qs = qs.filter(q => q.question_type !== 'essay');
      if (qs.length === 0) qs = generateDemoQuestions(config.subject, config.count);
      if (config.shuffle) qs = qs.sort(() => Math.random() - 0.5);
      setQuestions(qs.slice(0, config.count));
      // Practice mode only — this is where the free-trial paywall auto-pops
      // up after the last question. Exam/Speed mode already gets a hard
      // block via the 402 the global axios interceptor catches, since those
      // aren't meant to let someone quietly run out mid-timed-session.
      if (config.mode === 'practice' && res.data.free_trial) setFreeTrial(res.data.free_trial);
    } catch (err) {
      // Quota already exhausted before this session even started (e.g. this
      // browser used its 5 free questions in an earlier visit) — show the
      // paywall directly instead of quietly loading demo questions, which
      // would let them "practice" on fake content with no real path to
      // upgrade. This is the in-page equivalent of what a global redirect
      // used to try to do (and broke — see main.jsx for why that's gone).
      if (err.response?.status === 402 && err.response?.data?.code === 'FREE_LIMIT_REACHED') {
        setFreeTrial({ remaining: 0, limit: err.response.data.free_limit || 5 });
        setShowPaywall(true);
        setQuestions([]);
      } else {
        // Demo questions if API fails or no questions found
        setQuestions(generateDemoQuestions(config.subject, config.count));
      }
    } finally { setLoading(false); }
  };

  const generateDemoQuestions = (subject, count) => {
    return Array.from({ length: Math.min(count, 5) }, (_, i) => ({
      id: `demo-${i}`,
      question_text: `Sample ${subject} question ${i+1}. This is a demo question. Add real questions in the admin panel.`,
      options: ['Option A', 'Option B', 'Option C', 'Option D'],
      correct_answers: JSON.stringify(['Option A']),
      explanation: 'This is the explanation for this question.',
      marks: 1,
    }));
  };

  const handleAnswer = (qId, opt) => {
    setAnswers(a => ({ ...a, [qId]: opt }));
    if (config.mode === 'practice') {
      setRevealed(r => ({ ...r, [qId]: true }));
    }
  };

  const handleFinish = useCallback((auto = false) => {
    // Catch-all for the free-trial paywall: the per-question effect above
    // only fires once the last question's answer is revealed, which never
    // happens if it was skipped instead of answered. This guarantees the
    // paywall still appears before they can reach the results screen,
    // whether they answered every question, skipped the last one, or hit
    // Submit early.
    if (freeTrial && freeTrial.remaining === 0 && !showPaywall) {
      setShowPaywall(true);
      return;
    }
    clearInterval(timerRef.current);
    setDone(true);
    // Theory/essay questions have no single correct answer to grade against
    // (score comes from a human/AI grader elsewhere, not a right/wrong
    // check) — they're excluded from both the numerator and denominator
    // here so a practice session mixing objective + theory questions isn't
    // unfairly deflated by essay questions that can never contribute a
    // point under this scoring.
    const objectiveQs = questions.filter(q => safeParseArray(q.options).length > 0);
    const score = objectiveQs.reduce((s, q) => {
      const correct = safeParseArray(q.correct_answers);
      return answers[q.id] && correct.map(c=>c.toLowerCase().trim()).includes(answers[q.id].toLowerCase().trim()) ? s+1 : s;
    }, 0);
    onFinish({ questions, answers, score, total: objectiveQs.length, auto });
  }, [questions, answers, onFinish, freeTrial, showPaywall]);

  if (loading) return (
    <div style={{ minHeight:'100dvh', display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column', gap:16 }}>
      <div className="spinner" style={{ width:32, height:32 }}/>
      <p style={{ color:'var(--text-muted)' }}>Loading {config.count} questions...</p>
    </div>
  );

  // Quota was already exhausted before this session could even start (see
  // loadQuestions' catch block above) — nothing to practice on, so show
  // just the paywall rather than rendering the question engine against an
  // empty question list.
  if (!loading && questions.length === 0 && showPaywall) {
    return (
      <div style={{ minHeight:'100dvh', background:'var(--bg-base)' }}>
        <FreeTrialPaywall onDismiss={() => window.history.back()} />
      </div>
    );
  }

  const q = questions[current];
  if (!q) return null;
  const opts = safeParseArray(q.options);
  const correctAnswers = safeParseArray(q.correct_answers);
  const selected = answers[q.id];
  const isRevealed = revealed[q.id];
  const isWarning = timeLeft < 300;
  const isCritical = timeLeft < 60;
  const answered = Object.keys(answers).length;

  const isCorrect = (opt) => correctAnswers.map(c=>c.toLowerCase().trim()).includes(opt.toLowerCase().trim());

  return (
    <div style={{ minHeight:'100dvh', background:'var(--bg-base)', display:'flex', flexDirection:'column' }}>
      {/* Top bar */}
      <header style={{ height:52, display:'flex', alignItems:'center', gap:10, padding:'0 16px', background:'var(--bg-glass)', backdropFilter:'blur(20px)', WebkitBackdropFilter:'blur(20px)', borderBottom:'1px solid var(--border)', position:'sticky', top:0, zIndex:50, flexShrink:0 }}>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:12, fontWeight:700, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{config.subject} — {config.examType}</div>
          <div style={{ fontSize:10, color:'var(--text-muted)' }}>Q{current+1}/{questions.length}</div>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:6, padding:'5px 12px', borderRadius:'var(--r-full)', background: isCritical?'var(--danger-dim)': isWarning?'var(--warning-dim)':'var(--bg-raised)', border:`1px solid ${isCritical?'var(--danger)':isWarning?'var(--warning)':'var(--border)'}` }}>
          <span style={{ fontSize:11 }}>{isCritical?'🔴':isWarning?'🟡':'⏱'}</span>
          <span style={{ fontFamily:'var(--font-mono)', fontSize:13, fontWeight:700, color:isCritical?'var(--danger)':isWarning?'var(--warning)':'var(--text-primary)' }}>{formatTime(timeLeft)}</span>
        </div>
        <button onClick={() => setShowCalc(c=>!c)} style={{ width:32, height:32, borderRadius:'var(--r)', border:'1px solid var(--border-md)', background:showCalc?'var(--brand-dim)':'var(--bg-raised)', color:showCalc?'var(--brand-light)':'var(--text-secondary)', cursor:'pointer', fontSize:15, display:'flex', alignItems:'center', justifyContent:'center', transition:'all var(--t-fast)' }}>🧮</button>
        <button onClick={() => setShowPalette(p=>!p)} style={{ width:32, height:32, borderRadius:'var(--r)', border:'1px solid var(--border-md)', background:showPalette?'var(--brand-dim)':'var(--bg-raised)', color:showPalette?'var(--brand-light)':'var(--text-secondary)', cursor:'pointer', fontSize:15, display:'flex', alignItems:'center', justifyContent:'center' }}>⊞</button>
        <button onClick={() => handleFinish(false)} className="btn btn-primary btn-sm" style={{ whiteSpace:'nowrap' }}>Submit</button>
      </header>

      {/* Palette */}
      {showPalette && (
        <div style={{ background:'var(--bg-surface)', borderBottom:'1px solid var(--border)', padding:'10px 16px' }}>
          <div style={{ display:'flex', flexWrap:'wrap', gap:5 }}>
            {questions.map((_,i) => {
              const a = answers[questions[i]?.id];
              const isCur = i === current;
              return (
                <button key={i} onClick={() => { setCurrent(i); setShowPalette(false); }} style={{
                  width:30, height:30, borderRadius:'var(--r-sm)', fontFamily:'var(--font-mono)', fontSize:10, fontWeight:700, cursor:'pointer', transition:'all var(--t-fast)', border:'none',
                  background: isCur ? 'var(--brand)' : a ? 'var(--success-dim)' : flagged.has(questions[i]?.id) ? 'var(--warning-dim)' : 'var(--bg-raised)',
                  color: isCur ? '#fff' : a ? 'var(--success)' : flagged.has(questions[i]?.id) ? 'var(--warning)' : 'var(--text-muted)',
                }}>{i+1}</button>
              );
            })}
          </div>
          <div style={{ display:'flex', gap:14, marginTop:8, fontSize:10, color:'var(--text-muted)' }}>
            <span style={{ color:'var(--success)' }}>■ Answered ({answered})</span>
            <span style={{ color:'var(--warning)' }}>■ Flagged ({flagged.size})</span>
            <span>■ Unanswered ({questions.length-answered})</span>
          </div>
        </div>
      )}

      {/* Question */}
      <main style={{ flex:1, overflowY:'auto', paddingBottom:80 }}>
        <div style={{ maxWidth:700, margin:'0 auto', padding:'20px 16px' }}>
          <div style={{ display:'flex', gap:8, marginBottom:14, flexWrap:'wrap' }}>
            <span style={{ padding:'3px 10px', borderRadius:'var(--r-full)', background:'var(--brand-dim)', color:'var(--brand-light)', fontSize:10, fontWeight:700 }}>Q {current+1} of {questions.length}</span>
            {q.marks && <span style={{ padding:'3px 10px', borderRadius:'var(--r-full)', background:'var(--bg-raised)', color:'var(--text-muted)', fontSize:10, fontWeight:700 }}>{q.marks} mark{parseFloat(q.marks)>1?'s':''}</span>}
            {flagged.has(q.id) && <span style={{ padding:'3px 10px', borderRadius:'var(--r-full)', background:'var(--warning-dim)', color:'var(--warning)', fontSize:10, fontWeight:700 }}>⚑ Flagged</span>}
          </div>

          <div style={{ background:'var(--bg-surface)', border:'1px solid var(--border)', borderRadius:'var(--r-xl)', padding:'18px 20px', marginBottom:14, fontSize:15, lineHeight:1.8, fontWeight:500 }}>
            <MathText text={q.question_text} />
            {q.diagram_svg ? (
              <div style={{ marginTop:14, maxWidth:'100%' }} dangerouslySetInnerHTML={{ __html: q.diagram_svg }} />
            ) : q.media_url && (
              <img src={q.media_url} alt="Question diagram" style={{ display:'block', maxWidth:'100%', maxHeight:340, marginTop:14, borderRadius:'var(--r-lg)', border:'1px solid var(--border)' }} />
            )}
          </div>

          <div style={{ display:'flex', flexDirection:'column', gap:10, marginBottom:20 }}>
            {opts.length > 0 ? opts.map((opt, i) => {
              const isSelected = selected === opt;
              const correct = isCorrect(opt);
              let bg = 'var(--bg-surface)', border = 'var(--border-md)', color = 'var(--text-primary)';
              if (isRevealed) {
                if (correct) { bg='var(--success-dim)'; border='var(--success)'; color='var(--success)'; }
                else if (isSelected && !correct) { bg='var(--danger-dim)'; border='var(--danger)'; color='var(--danger)'; }
              } else if (isSelected) {
                bg='var(--brand-dim)'; border='var(--brand)'; color='var(--brand-light)';
              }
              return (
                <button key={i} onClick={() => !isRevealed && handleAnswer(q.id, opt)} style={{
                  display:'flex', alignItems:'center', gap:12, padding:'12px 16px',
                  background:bg, border:`1.5px solid ${border}`, borderRadius:'var(--r-lg)',
                  cursor:isRevealed?'default':'pointer', textAlign:'left', width:'100%',
                  transition:'all var(--t-fast)',
                  transform: isSelected && !isRevealed ? 'scale(1.005)' : '',
                  WebkitTapHighlightColor:'transparent',
                }}>
                  <div style={{ width:30, height:30, borderRadius:8, flexShrink:0, background: isSelected||isRevealed&&correct ? border : 'var(--bg-raised)', border:`1.5px solid ${border}`, display:'flex', alignItems:'center', justifyContent:'center', fontFamily:'var(--font-display)', fontSize:12, fontWeight:800, color: isSelected || (isRevealed&&correct) ? '#fff' : 'var(--text-muted)', transition:'all var(--t-fast)' }}>{LETTERS[i]}</div>
                  <span style={{ fontSize:14, fontWeight: isSelected?600:400, color, lineHeight:1.5 }}><MathText text={opt} inline /></span>
                  {isRevealed && correct && <span style={{ marginLeft:'auto', fontSize:16 }}>✓</span>}
                  {isRevealed && isSelected && !correct && <span style={{ marginLeft:'auto', fontSize:16 }}>✗</span>}
                </button>
              );
            }) : (
              // Theory/essay question — no options to pick from. There's no
              // machine-gradable right/wrong here, so the student writes
              // their own answer/working, then reveals the step-by-step
              // explanation whenever they're ready to check their approach.
              <div>
                <textarea
                  value={selected || ''}
                  onChange={e => setAnswers(a => ({ ...a, [q.id]: e.target.value }))}
                  placeholder="Write your answer / working here…"
                  rows={7}
                  disabled={isRevealed}
                  style={{
                    width:'100%', padding:'14px 16px', borderRadius:'var(--r-lg)',
                    border:'1.5px solid var(--border-md)', background:'var(--bg-surface)',
                    color:'var(--text-primary)', fontFamily:'var(--font-body)', fontSize:14,
                    lineHeight:1.7, resize:'vertical',
                  }}
                />
                {!isRevealed && (
                  <button
                    className="btn btn-primary"
                    style={{ marginTop:12, width:'100%', justifyContent:'center' }}
                    onClick={() => setRevealed(r => ({ ...r, [q.id]: true }))}
                  >
                    Show Step-by-Step Explanation
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Explanation (practice mode) — every question type gets one,
              including theory/essay above, once revealed. */}
          {isRevealed && (
            <ExplanationBox question={q} theme="light" style={{ background:'var(--info-dim)', border:'1px solid var(--info)', borderRadius:'var(--r-xl)', padding:'14px 18px', animation:'fadeIn 0.3s both' }} />
          )}
        </div>
      </main>

      {/* Bottom nav */}
      <div style={{ position:'fixed', bottom:0, left:0, right:0, background:'var(--bg-glass)', backdropFilter:'blur(20px)', WebkitBackdropFilter:'blur(20px)', borderTop:'1px solid var(--border)', padding:'10px 16px', paddingBottom:'calc(10px + env(safe-area-inset-bottom))', display:'flex', alignItems:'center', gap:10, zIndex:40 }}>
        <button className="btn btn-secondary" onClick={() => setCurrent(c=>Math.max(0,c-1))} disabled={current===0} style={{ flex:1, justifyContent:'center' }}>← Prev</button>
        <button onClick={() => setFlagged(f => { const n=new Set(f); n.has(q.id)?n.delete(q.id):n.add(q.id); return n; })} style={{ width:42, height:42, borderRadius:'var(--r)', border:`1px solid ${flagged.has(q.id)?'var(--warning)':'var(--border)'}`, background:flagged.has(q.id)?'var(--warning-dim)':'var(--bg-raised)', color:flagged.has(q.id)?'var(--warning)':'var(--text-muted)', cursor:'pointer', fontSize:16, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, transition:'all var(--t-fast)' }}>⚑</button>
        {current === questions.length-1 ? (
          <button className="btn btn-primary" onClick={() => handleFinish(false)} style={{ flex:1, justifyContent:'center' }}>Submit ✓</button>
        ) : (
          <button className="btn btn-primary" onClick={() => setCurrent(c=>Math.min(questions.length-1,c+1))} style={{ flex:1, justifyContent:'center' }}>Next →</button>
        )}
      </div>

      {showCalc && <Calculator onClose={() => setShowCalc(false)} />}
      {showPaywall && (
        <FreeTrialPaywall onDismiss={() => setShowPaywall(false)} />
      )}
    </div>
  );
}

// ── RESULTS SCREEN ────────────────────────────────────────────
function ResultsScreen({ result, config, onRetry, onNew }) {
  const { score, total, questions, answers } = result;
  const pct = total > 0 ? (score/total)*100 : 0;
  const passed = pct >= 50;
  const [tab, setTab] = useState('summary');
  // "Skipped" should only count against objectively-gradable questions —
  // matches how `total` itself already excludes essay/theory questions
  // (see handleFinish), so this stays consistent with score/total instead
  // of going negative when theory questions were also answered.
  const objectiveAnswered = questions.filter(q => safeParseArray(q.options).length > 0 && answers[q.id]).length;

  const getGrade = (p) => {
    if (p>=90) return {g:'A1',c:'var(--success)'}; if (p>=80) return {g:'B2',c:'var(--success)'};
    if (p>=75) return {g:'B3',c:'var(--brand-light)'}; if (p>=70) return {g:'C4',c:'var(--brand-light)'};
    if (p>=60) return {g:'C5',c:'var(--info)'}; if (p>=50) return {g:'E8',c:'var(--warning)'};
    return {g:'F9',c:'var(--danger)'};
  };
  const {g,c} = getGrade(pct);

  return (
    <div style={{ minHeight:'100dvh', background:'var(--bg-base)' }}>
      <header style={{ height:52, display:'flex', alignItems:'center', justifyContent:'space-between', padding:'0 20px', background:'var(--bg-glass)', backdropFilter:'blur(20px)', WebkitBackdropFilter:'blur(20px)', borderBottom:'1px solid var(--border)', position:'sticky', top:0, zIndex:50 }}>
        <div style={{ fontFamily:'var(--font-display)', fontSize:15, fontWeight:800 }}>Practice Results</div>
        <div style={{ display:'flex', gap:8 }}>
          <button className="btn btn-secondary btn-sm" onClick={onRetry}>↩ Retry</button>
          <button className="btn btn-primary btn-sm" onClick={onNew}>New Session</button>
        </div>
      </header>

      <div style={{ maxWidth:700, margin:'0 auto', padding:'24px 16px 60px' }}>
        {/* Score card */}
        <div style={{ background:`linear-gradient(135deg,${passed?'#16A34A':'#DC2626'}cc,${passed?'#22C55E':'#EF4444'})`, borderRadius:'var(--r-2xl)', padding:'28px', marginBottom:20, textAlign:'center', color:'#fff' }}>
          <div style={{ fontSize:48, marginBottom:8 }}>{passed?'🎉':'📖'}</div>
          <div style={{ fontFamily:'var(--font-display)', fontSize:56, fontWeight:900, letterSpacing:'-0.04em', lineHeight:1 }}>{score}<span style={{ fontSize:24, opacity:0.7 }}>/{total}</span></div>
          <div style={{ fontSize:20, fontWeight:700, marginTop:4 }}>{pct.toFixed(1)}% — Grade {g}</div>
          <div style={{ fontSize:14, opacity:0.8, marginTop:6 }}>{passed?'Excellent work! Keep it up!':'Review the wrong answers and try again.'}</div>
          <div style={{ display:'flex', gap:16, justifyContent:'center', marginTop:16 }}>
            <div style={{ textAlign:'center' }}><div style={{ fontSize:20, fontWeight:800 }}>{score}</div><div style={{ fontSize:10, opacity:0.7, textTransform:'uppercase' }}>Correct</div></div>
            <div style={{ width:1, background:'rgba(255,255,255,0.3)' }}/>
            <div style={{ textAlign:'center' }}><div style={{ fontSize:20, fontWeight:800 }}>{total-score}</div><div style={{ fontSize:10, opacity:0.7, textTransform:'uppercase' }}>Wrong</div></div>
            <div style={{ width:1, background:'rgba(255,255,255,0.3)' }}/>
            <div style={{ textAlign:'center' }}><div style={{ fontSize:20, fontWeight:800 }}>{Math.max(0, total-objectiveAnswered)}</div><div style={{ fontSize:10, opacity:0.7, textTransform:'uppercase' }}>Skipped</div></div>
          </div>
        </div>

        {/* Tab */}
        <div style={{ display:'flex', background:'var(--bg-raised)', borderRadius:'var(--r)', padding:4, marginBottom:16, border:'1px solid var(--border)' }}>
          {[['summary','Summary'],['review','Review Answers']].map(([id,label])=>(
            <button key={id} onClick={()=>setTab(id)} style={{ flex:1, padding:'8px', border:'none', borderRadius:8, cursor:'pointer', background:tab===id?'var(--brand)':'transparent', color:tab===id?'#fff':'var(--text-secondary)', fontFamily:'var(--font-body)', fontWeight:700, fontSize:13, transition:'all var(--t-fast)' }}>{label}</button>
          ))}
        </div>

        {tab === 'summary' && (
          <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
            <div style={{ background:'var(--bg-surface)', border:'1px solid var(--border)', borderRadius:'var(--r-xl)', padding:'18px 20px' }}>
              <div style={{ fontSize:12, fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:12 }}>Performance</div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
                {[['Score',`${score}/${total}`,'var(--brand-light)'],['Percentage',`${pct.toFixed(1)}%`,c],['Grade',g,c],['Result',passed?'PASSED':'FAILED',passed?'var(--success)':'var(--danger)'],['Subject',config.subject,'var(--text-primary)'],['Exam Type',config.examType,'var(--text-primary)']].map(([k,v,col])=>(
                  <div key={k} style={{ padding:'12px', background:'var(--bg-raised)', borderRadius:'var(--r-lg)', border:'1px solid var(--border)' }}>
                    <div style={{ fontSize:10, fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:4 }}>{k}</div>
                    <div style={{ fontSize:16, fontWeight:800, color:col, fontFamily:'var(--font-display)' }}>{v}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {tab === 'review' && (
          <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
            {questions.map((q,i) => {
              const opts = safeParseArray(q.options);
              const isEssay = opts.length === 0;
              const correctAnswers = safeParseArray(q.correct_answers);
              const userAnswer = answers[q.id];
              const correct = !isEssay && userAnswer && correctAnswers.map(c=>c.toLowerCase().trim()).includes(userAnswer.toLowerCase().trim());
              return (
                <div key={q.id} style={{ background:'var(--bg-surface)', border:`1px solid ${isEssay ? 'var(--border)' : correct?'rgba(16,185,129,0.3)':userAnswer?'rgba(239,68,68,0.3)':'var(--border)'}`, borderRadius:'var(--r-xl)', padding:'16px 18px' }}>
                  <div style={{ display:'flex', gap:10, marginBottom:10 }}>
                    <span style={{ fontSize:11, padding:'2px 8px', borderRadius:'var(--r-full)', fontWeight:700, background:isEssay?(userAnswer?'var(--info-dim)':'var(--bg-raised)'):(correct?'var(--success-dim)':userAnswer?'var(--danger-dim)':'var(--bg-raised)'), color:isEssay?(userAnswer?'var(--info)':'var(--text-muted)'):(correct?'var(--success)':userAnswer?'var(--danger)':'var(--text-muted)') }}>
                      {isEssay ? (userAnswer ? '✍ Answered' : '— Skipped') : (correct?'✓ Correct':userAnswer?'✗ Wrong':'— Skipped')}
                    </span>
                    <span style={{ fontSize:11, color:'var(--text-muted)' }}>Q{i+1}</span>
                  </div>
                  <div style={{ fontSize:13, fontWeight:600, marginBottom:10, lineHeight:1.6 }}><MathText text={q.question_text} /></div>
                  {isEssay ? (
                    userAnswer && (
                      <div style={{ padding:'10px 12px', background:'var(--bg-raised)', borderRadius:'var(--r-lg)', fontSize:12, color:'var(--text-secondary)', lineHeight:1.7, whiteSpace:'pre-wrap', marginBottom:4 }}>
                        {userAnswer}
                      </div>
                    )
                  ) : (
                    <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
                      {opts.map((opt,oi) => {
                        const isCorrect = correctAnswers.map(c=>c.toLowerCase().trim()).includes(opt.toLowerCase().trim());
                        const isUser = userAnswer === opt;
                        return (
                          <div key={oi} style={{ display:'flex', alignItems:'center', gap:8, padding:'6px 10px', borderRadius:'var(--r)', fontSize:12, background:isCorrect?'var(--success-dim)':isUser&&!isCorrect?'var(--danger-dim)':'transparent' }}>
                            <span style={{ fontFamily:'var(--font-mono)', fontSize:10, fontWeight:700, color:'var(--text-muted)' }}>{LETTERS[oi]}</span>
                            <span style={{ color:isCorrect?'var(--success)':isUser&&!isCorrect?'var(--danger)':'var(--text-secondary)' }}><MathText text={opt} inline /></span>
                            {isCorrect && <span style={{ marginLeft:'auto', fontSize:12 }}>✓</span>}
                            {isUser && !isCorrect && <span style={{ marginLeft:'auto', fontSize:12 }}>✗</span>}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <div style={{ marginTop:10 }}>
                    <ExplanationBox question={q} theme="light" style={{ padding: '10px 12px', fontSize: 12 }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── MAIN PRACTICE PAGE ────────────────────────────────────────
export default function PracticeMode() {
  const [phase,  setPhase]  = useState('setup'); // setup | exam | results
  const [config, setConfig] = useState(null);
  const [result, setResult] = useState(null);

  if (phase === 'setup') return <SetupScreen onStart={cfg => { setConfig(cfg); setPhase('exam'); }} />;
  if (phase === 'exam')  return <PracticeEngine config={config} onFinish={r => { setResult(r); setPhase('results'); }} />;
  if (phase === 'results') return <ResultsScreen result={result} config={config} onRetry={() => setPhase('exam')} onNew={() => { setConfig(null); setPhase('setup'); }} />;
  return null;
}
