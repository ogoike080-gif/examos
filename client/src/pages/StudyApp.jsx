import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import { readOfflineCache, writeOfflineCache } from '../utils/offlineCache';

const API = '/api';
const LETTERS = ['A','B','C','D','E'];

function safeParseArray(v) {
  if (Array.isArray(v)) return v;
  if (!v) return [];
  try { const p = JSON.parse(v); return Array.isArray(p)?p:[]; } catch { return []; }
}

function formatTime(s) {
  const h = Math.floor(s/3600), m = Math.floor((s%3600)/60), sec = s%60;
  if (h>0) return `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
}

// ── EXAM TYPES & SUBJECTS ─────────────────────────────────────
const EXAM_TYPES = ['JAMB','WAEC','NECO','NABTEB','POST_UTME','CUSTOM'];
const SUBJECTS = [
  'Mathematics','English Language','Physics','Chemistry','Biology',
  'Economics','Government','Literature in English','Geography',
  'Computer Studies','Accounting','Agricultural Science',
  'Civic Education','Commerce','Further Mathematics',
  'Technical Drawing','Islamic Studies','Christian Religious Studies',
];
const YEARS = ['All Years','2024','2023','2022','2021','2020','2019','2018',
  '2017','2016','2015','2014','2013','2012','2011','2010',
  '2009','2008','2007','2006','2005'];

// ── SETUP SCREEN ──────────────────────────────────────────────
function SetupScreen({ onStart }) {
  const [searchParams] = useSearchParams();
  const [examType,  setExamType]  = useState('JAMB');
  const [subject,   setSubject]   = useState(searchParams.get('subject') || 'Mathematics');
  const [year,      setYear]      = useState('All Years');
  const [count,     setCount]     = useState(60);
  const [duration,  setDuration]  = useState(120);
  const [mode,      setMode]      = useState('mock'); // mock | practice | study
  const [shuffle,   setShuffle]   = useState(true);
  const [showInfo,  setShowInfo]  = useState(false);

  const examColors = {
    JAMB:'#2563EB', WAEC:'#16A34A', NECO:'#D97706',
    NABTEB:'#DC2626', POST_UTME:'#7C3AED', CUSTOM:'#6366F1'
  };

  return (
    <div style={{ minHeight:'100dvh', background:'#F0F4F8', fontFamily:"'Inter',sans-serif" }}>
      {/* Header */}
      <div style={{ background:'#1E3A5F', padding:'12px 24px', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
        <div style={{ display:'flex', alignItems:'center', gap:12 }}>
          <div style={{ width:36, height:36, borderRadius:8, background:'linear-gradient(135deg,#6366F1,#818CF8)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:18, fontWeight:900, color:'#fff' }}>E</div>
          <div>
            <div style={{ color:'#fff', fontWeight:800, fontSize:16 }}>ExamOS Practice</div>
            <div style={{ color:'rgba(255,255,255,0.6)', fontSize:11 }}>JAMB · WAEC · NECO · POST-UTME</div>
          </div>
        </div>
      </div>

      <div style={{ maxWidth:800, margin:'0 auto', padding:'32px 16px' }}>
        <h1 style={{ fontSize:'1.6rem', fontWeight:800, color:'#1E3A5F', marginBottom:6 }}>Configure Practice Session</h1>
        <p style={{ color:'#64748B', fontSize:14, marginBottom:28 }}>Select your exam, subject, and preferences below</p>

        {/* Exam type */}
        <div style={{ background:'#fff', borderRadius:12, padding:'20px', marginBottom:16, boxShadow:'0 1px 4px rgba(0,0,0,0.08)' }}>
          <div style={{ fontSize:11, fontWeight:700, color:'#94A3B8', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:12 }}>Exam Type</div>
          <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
            {EXAM_TYPES.map(e => (
              <button key={e} onClick={() => setExamType(e)} style={{
                padding:'8px 18px', borderRadius:20, border:`2px solid ${examType===e ? examColors[e] : '#E2E8F0'}`,
                background: examType===e ? examColors[e] : '#F8FAFC',
                color: examType===e ? '#fff' : '#475569',
                fontWeight:700, fontSize:13, cursor:'pointer', transition:'all 0.15s',
                fontFamily:"'Inter',sans-serif",
              }}>{e}</button>
            ))}
          </div>
        </div>

        {/* Subject + Year */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16, marginBottom:16 }}>
          <div style={{ background:'#fff', borderRadius:12, padding:'20px', boxShadow:'0 1px 4px rgba(0,0,0,0.08)' }}>
            <div style={{ fontSize:11, fontWeight:700, color:'#94A3B8', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:10 }}>Subject</div>
            <select value={subject} onChange={e => setSubject(e.target.value)} style={{ width:'100%', padding:'10px 12px', borderRadius:8, border:'1.5px solid #E2E8F0', background:'#F8FAFC', color:'#1E293B', fontFamily:"'Inter',sans-serif", fontSize:14, cursor:'pointer' }}>
              {SUBJECTS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div style={{ background:'#fff', borderRadius:12, padding:'20px', boxShadow:'0 1px 4px rgba(0,0,0,0.08)' }}>
            <div style={{ fontSize:11, fontWeight:700, color:'#94A3B8', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:10 }}>Year</div>
            <select value={year} onChange={e => setYear(e.target.value)} style={{ width:'100%', padding:'10px 12px', borderRadius:8, border:'1.5px solid #E2E8F0', background:'#F8FAFC', color:'#1E293B', fontFamily:"'Inter',sans-serif", fontSize:14, cursor:'pointer' }}>
              {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
        </div>

        {/* Questions + Duration */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16, marginBottom:16 }}>
          <div style={{ background:'#fff', borderRadius:12, padding:'20px', boxShadow:'0 1px 4px rgba(0,0,0,0.08)' }}>
            <div style={{ fontSize:11, fontWeight:700, color:'#94A3B8', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:10 }}>No. of Questions</div>
            <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
              {[10,20,40,60,80,100].map(n => (
                <button key={n} onClick={() => setCount(n)} style={{ padding:'7px 14px', borderRadius:8, border:`2px solid ${count===n?'#2563EB':'#E2E8F0'}`, background:count===n?'#EFF6FF':'#F8FAFC', color:count===n?'#2563EB':'#64748B', fontWeight:700, fontSize:13, cursor:'pointer', fontFamily:"'Inter',sans-serif", transition:'all 0.12s' }}>{n}</button>
              ))}
            </div>
          </div>
          <div style={{ background:'#fff', borderRadius:12, padding:'20px', boxShadow:'0 1px 4px rgba(0,0,0,0.08)' }}>
            <div style={{ fontSize:11, fontWeight:700, color:'#94A3B8', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:10 }}>Duration (minutes)</div>
            <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
              {[15,30,60,90,120,180].map(d => (
                <button key={d} onClick={() => setDuration(d)} style={{ padding:'7px 14px', borderRadius:8, border:`2px solid ${duration===d?'#2563EB':'#E2E8F0'}`, background:duration===d?'#EFF6FF':'#F8FAFC', color:duration===d?'#2563EB':'#64748B', fontWeight:700, fontSize:13, cursor:'pointer', fontFamily:"'Inter',sans-serif", transition:'all 0.12s' }}>{d}</button>
              ))}
            </div>
          </div>
        </div>

        {/* Mode */}
        <div style={{ background:'#fff', borderRadius:12, padding:'20px', marginBottom:16, boxShadow:'0 1px 4px rgba(0,0,0,0.08)' }}>
          <div style={{ fontSize:11, fontWeight:700, color:'#94A3B8', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:12 }}>Select Mode</div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:10 }}>
            {[
              { id:'mock',     icon:'📝', label:'Mock Exam',   desc:'Timed, no hints, review at end' },
              { id:'practice', icon:'✏️',  label:'Practice',   desc:'See correct answer immediately' },
              { id:'study',    icon:'📖', label:'Study Mode',  desc:'With explanations, no timer' },
              { id:'adaptive', icon:'🎯', label:'Adaptive AI', desc:'Difficulty adjusts to how you do' },
            ].map(m => (
              <button key={m.id} onClick={() => setMode(m.id)} style={{
                padding:'14px 12px', borderRadius:10,
                border:`2px solid ${mode===m.id?'#2563EB':'#E2E8F0'}`,
                background:mode===m.id?'#EFF6FF':'#F8FAFC',
                cursor:'pointer', textAlign:'center', fontFamily:"'Inter',sans-serif",
                transition:'all 0.12s',
              }}>
                <div style={{ fontSize:24, marginBottom:6 }}>{m.icon}</div>
                <div style={{ fontWeight:700, fontSize:13, color:mode===m.id?'#2563EB':'#1E293B', marginBottom:3 }}>{m.label}</div>
                <div style={{ fontSize:11, color:'#94A3B8', lineHeight:1.4 }}>{m.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Options row */}
        <div style={{ background:'#fff', borderRadius:12, padding:'16px 20px', marginBottom:16, boxShadow:'0 1px 4px rgba(0,0,0,0.08)', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <div style={{ fontSize:13, fontWeight:600, color:'#1E293B' }}>Shuffle Questions</div>
          <div onClick={() => setShuffle(s=>!s)} style={{ width:44, height:24, borderRadius:12, background:shuffle?'#2563EB':'#CBD5E1', position:'relative', cursor:'pointer', transition:'background 0.2s', flexShrink:0 }}>
            <div style={{ position:'absolute', top:2, left:shuffle?22:2, width:20, height:20, borderRadius:'50%', background:'#fff', transition:'left 0.2s', boxShadow:'0 1px 4px rgba(0,0,0,0.2)' }}/>
          </div>
        </div>

        {/* Instructions */}
        <div style={{ background:'#fff', borderRadius:12, overflow:'hidden', marginBottom:24, boxShadow:'0 1px 4px rgba(0,0,0,0.08)' }}>
          <button onClick={() => setShowInfo(s=>!s)} style={{ width:'100%', padding:'14px 20px', background:'none', border:'none', cursor:'pointer', display:'flex', justifyContent:'space-between', alignItems:'center', fontFamily:"'Inter',sans-serif" }}>
            <span style={{ fontSize:13, fontWeight:700, color:'#1E3A5F' }}>📋 Instructions</span>
            <span style={{ fontSize:12, color:'#94A3B8', transform:showInfo?'rotate(180deg)':'none', transition:'transform 0.2s' }}>▼</span>
          </button>
          {showInfo && (
            <div style={{ padding:'0 20px 16px', fontSize:13, color:'#475569', lineHeight:1.9, borderTop:'1px solid #F1F5F9' }}>
              <ul style={{ paddingLeft:18, marginTop:12 }}>
                <li>Use the question palette on the left to jump to any question.</li>
                <li>Click a radio button to select your answer.</li>
                <li>In <b>Practice mode</b>, the correct answer shows immediately after selection.</li>
                <li>In <b>Mock Exam</b> mode, answers are revealed only after submission.</li>
                <li>In <b>Study mode</b>, full explanations are shown with each answer.</li>
                <li>Use the Bookmark button to flag questions for review.</li>
                <li>The calculator is available at all times in the toolbar.</li>
                <li>Submit before the timer expires to save your score.</li>
              </ul>
            </div>
          )}
        </div>

        {/* Summary + Start */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16 }}>
          <div style={{ background:'#1E3A5F', borderRadius:12, padding:'18px 20px', color:'#fff' }}>
            <div style={{ fontSize:12, fontWeight:700, opacity:0.6, textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:12 }}>Session Summary</div>
            {[['Exam',examType],['Subject',subject],['Year',year],['Questions',count],['Duration',`${duration} min`],['Mode',mode.charAt(0).toUpperCase()+mode.slice(1)]].map(([k,v])=>(
              <div key={k} style={{ display:'flex', justifyContent:'space-between', fontSize:12, padding:'5px 0', borderBottom:'1px solid rgba(255,255,255,0.1)' }}>
                <span style={{ opacity:0.6 }}>{k}</span><span style={{ fontWeight:700 }}>{v}</span>
              </div>
            ))}
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
            <button onClick={() => onStart({ examType, subject, year, count, duration, mode, shuffle })}
              style={{ flex:1, background:'linear-gradient(135deg,#2563EB,#1D4ED8)', color:'#fff', border:'none', borderRadius:12, fontSize:16, fontWeight:800, cursor:'pointer', fontFamily:"'Inter',sans-serif", padding:'0 20px', boxShadow:'0 4px 16px rgba(37,99,235,0.3)', transition:'all 0.15s' }}
              onMouseOver={e => e.currentTarget.style.transform='translateY(-2px)'}
              onMouseOut={e => e.currentTarget.style.transform=''}
            >
              🚀 Start Session<br/><span style={{ fontSize:12, opacity:0.8, fontWeight:500 }}>{count} questions · {duration} min</span>
            </button>
            <SaveOfflineButton config={{ examType, subject, year, count }} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ── SAVE FOR OFFLINE ─────────────────────────────────────────
function SaveOfflineButton({ config }) {
  const [state, setState] = useState('idle'); // idle | saving | saved | error | already

  useEffect(() => {
    const key = `examos-offline-qset:${config.subject}:${config.examType}:${config.year}`;
    setState(readOfflineCache(key)?.length ? 'already' : 'idle');
  }, [config.subject, config.examType, config.year]);

  const handleSave = async () => {
    if (!navigator.onLine) return setState('error');
    setState('saving');
    try {
      const params = { limit: config.count };
      if (config.subject !== 'All') params.subject = config.subject;
      if (config.examType !== 'CUSTOM') params.exam_type = config.examType;
      if (config.year !== 'All Years') params.year = config.year;
      const res = await axios.get(`${API}/questions`, { params });
      const qs = (res.data.questions || []).map(q => ({ ...q, options: safeParseArray(q.options) }));
      if (!qs.length) return setState('error');
      const key = `examos-offline-qset:${config.subject}:${config.examType}:${config.year}`;
      writeOfflineCache(key, qs);
      setState('saved');
    } catch { setState('error'); }
  };

  const labels = {
    idle:    { text: '📥 Save for Offline', bg:'#fff', color:'#2563EB', border:'2px solid #2563EB' },
    saving:  { text: '⏳ Saving…',           bg:'#fff', color:'#94A3B8', border:'2px solid #E2E8F0' },
    saved:   { text: '✅ Saved for Offline', bg:'#ECFDF5', color:'#16A34A', border:'2px solid #16A34A' },
    already: { text: '✅ Already Saved · Tap to Refresh', bg:'#ECFDF5', color:'#16A34A', border:'2px solid #16A34A' },
    error:   { text: '⚠️ Couldn\'t save — check connection', bg:'#FEF2F2', color:'#DC2626', border:'2px solid #FCA5A5' },
  };
  const l = labels[state];

  return (
    <button
      onClick={handleSave}
      disabled={state === 'saving'}
      style={{
        padding:'12px 16px', borderRadius:10, fontSize:13, fontWeight:700,
        cursor: state==='saving' ? 'default' : 'pointer',
        fontFamily:"'Inter',sans-serif", transition:'all 0.15s',
        background:l.bg, color:l.color, border:l.border,
      }}
    >
      {l.text}
      <div style={{ fontSize:10.5, fontWeight:500, opacity:0.75, marginTop:2 }}>
        Practice offline later on this subject, even with no connection
      </div>
    </button>
  );
}

// ── CALCULATOR ────────────────────────────────────────────────
function SimpleCalc({ onClose }) {
  const [display, setDisplay] = useState('0');
  const [prev, setPrev] = useState(null);
  const [op, setOp] = useState(null);
  const [fresh, setFresh] = useState(false);

  const press = (val) => {
    if (val==='C') { setDisplay('0'); setPrev(null); setOp(null); setFresh(false); return; }
    if (val==='⌫') { setDisplay(d=>d.length>1?d.slice(0,-1):'0'); return; }
    if (['+','-','×','÷'].includes(val)) {
      setPrev(display); setOp(val); setFresh(true); return;
    }
    if (val==='=') {
      if (!op||!prev) return;
      const a=parseFloat(prev), b=parseFloat(display);
      const res = op==='+'?a+b:op==='-'?a-b:op==='×'?a*b:b===0?'Error':a/b;
      setDisplay(String(parseFloat(res.toPrecision(10)))); setPrev(null); setOp(null); setFresh(false); return;
    }
    if (val==='.') { if (!display.includes('.')) setDisplay(d=>d+'.'); return; }
    if (fresh||display==='0') { setDisplay(val); setFresh(false); }
    else { if (display.replace('-','').replace('.','').length<12) setDisplay(d=>d+val); }
  };

  const rows=[['C','⌫','%','÷'],['7','8','9','×'],['4','5','6','-'],['1','2','3','+'],['.','0','=','=']];
  return (
    <div style={{ position:'fixed', bottom:80, right:20, width:220, background:'#1C1C1E', borderRadius:16, boxShadow:'0 20px 60px rgba(0,0,0,0.5)', border:'1px solid rgba(255,255,255,0.1)', overflow:'hidden', zIndex:9999, fontFamily:'system-ui' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'10px 14px 4px' }}>
        <span style={{ fontSize:11, color:'rgba(255,255,255,0.4)', fontWeight:700 }}>CALC</span>
        <button onClick={onClose} style={{ background:'#FF5F57', border:'none', borderRadius:'50%', width:13, height:13, cursor:'pointer', fontSize:0 }}/>
      </div>
      <div style={{ textAlign:'right', fontSize:display.length>8?26:34, fontWeight:300, color:'#fff', padding:'4px 16px 10px', minHeight:50, lineHeight:1 }}>{display}</div>
      <div style={{ padding:'0 8px 10px' }}>
        {rows.map((row,ri) => (
          <div key={ri} style={{ display:'flex', gap:6, marginBottom:6 }}>
            {row.map((btn,bi) => {
              if (ri===4&&bi===2&&btn==='=') return null;
              const isOp = ['+','-','×','÷','='].includes(btn);
              const isGray = ['C','⌫','%'].includes(btn);
              const wide = ri===4&&bi===2;
              return (
                <button key={bi} onClick={() => press(btn)} style={{
                  flex: wide?2:1, height:44, borderRadius:9, border:'none', cursor:'pointer',
                  background:isOp?'#FF9F0A':isGray?'#636366':'#2C2C2E',
                  color:isGray?'#000':'#fff', fontSize:17, fontWeight:400, transition:'opacity 0.1s',
                  fontFamily:'system-ui',
                }}
                  onMouseDown={e=>e.currentTarget.style.opacity='0.7'}
                  onMouseUp={e=>e.currentTarget.style.opacity='1'}
                >{btn}</button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── MAIN EXAM SCREEN (ExamGuide style) ───────────────────────
function ExamScreen({ config, onFinish }) {
  const [questions,  setQuestions]  = useState([]);
  const [answers,    setAnswers]    = useState({});
  const [revealed,   setRevealed]   = useState({});
  const [bookmarked, setBookmarked] = useState(new Set());
  const [current,    setCurrent]    = useState(0);
  const [timeLeft,   setTimeLeft]   = useState(config.mode==='study' ? 999999 : config.duration * 60);
  const [loading,    setLoading]    = useState(true);
  const [showCalc,   setShowCalc]   = useState(false);
  const [attempts,   setAttempts]   = useState(0);
  const [usingOfflineCache, setUsingOfflineCache] = useState(false);
  const [isOnline,   setIsOnline]   = useState(navigator.onLine);
  const [lowData,    setLowData]    = useState(() => localStorage.getItem('examos-lowdata') === '1');
  const [adaptiveDifficulty, setAdaptiveDifficulty] = useState('medium');
  const poolRef = useRef({ easy: [], medium: [], hard: [] });
  const adaptedChunksRef = useRef(new Set());
  const ADAPT_CHUNK = 5;
  const timerRef = useRef(null);
  const submittedRef = useRef(false);

  useEffect(() => {
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => { window.removeEventListener('online', goOnline); window.removeEventListener('offline', goOffline); };
  }, []);

  const toggleLowData = () => {
    setLowData(v => { localStorage.setItem('examos-lowdata', v ? '0' : '1'); return !v; });
  };

  const cacheKey = `examos-offline-qset:${config.subject}:${config.examType}:${config.year}`;

  useEffect(() => { loadQuestions(); }, []);

  // Adaptive AI: every time the student crosses into a new 5-question chunk
  // for the first time, look at how they did in the chunk just completed and
  // swap the upcoming chunk's questions for easier/harder ones accordingly.
  // Already-visited questions are never touched — only ones ahead, not yet seen.
  useEffect(() => {
    if (config.mode !== 'adaptive' || loading || questions.length === 0) return;
    const chunkIdx = Math.floor(current / ADAPT_CHUNK);
    if (chunkIdx === 0 || adaptedChunksRef.current.has(chunkIdx)) return;
    if (chunkIdx * ADAPT_CHUNK > current) return; // haven't actually reached this chunk yet

    const prevStart = (chunkIdx - 1) * ADAPT_CHUNK;
    const prevEnd = Math.min(chunkIdx * ADAPT_CHUNK, questions.length);
    let correct = 0, answered = 0;
    for (let i = prevStart; i < prevEnd; i++) {
      const q = questions[i];
      const ans = answers[q.id];
      if (!ans) continue;
      answered++;
      const correctSet = safeParseArray(q.correct_answers).map(c => c.toLowerCase().trim());
      if (correctSet.includes(String(ans).toLowerCase().trim())) correct++;
    }

    adaptedChunksRef.current.add(chunkIdx);
    if (answered === 0) return; // nothing answered in that chunk — leave upcoming difficulty as-is

    const accuracy = correct / answered;
    const order = ['easy', 'medium', 'hard'];
    const currentLevel = order.indexOf(adaptiveDifficulty);
    let nextLevel = currentLevel;
    if (accuracy >= 0.75) nextLevel = Math.min(currentLevel + 1, 2);
    else if (accuracy <= 0.4) nextLevel = Math.max(currentLevel - 1, 0);
    const target = order[nextLevel];
    setAdaptiveDifficulty(target);

    const nextStart = chunkIdx * ADAPT_CHUNK;
    const nextEnd = Math.min(nextStart + ADAPT_CHUNK, questions.length);
    const pool = poolRef.current;
    const replacement = [];
    for (let i = nextStart; i < nextEnd; i++) {
      const q = pool[target].pop() || pool.medium.pop() || pool.easy.pop() || pool.hard.pop();
      if (q) replacement.push(q); else replacement.push(questions[i]); // pool exhausted — keep what was there
    }
    setQuestions(prev => {
      const copy = [...prev];
      for (let i = 0; i < replacement.length; i++) copy[nextStart + i] = replacement[i];
      return copy;
    });
  }, [current, loading]);

  useEffect(() => {
    if (loading || config.mode==='study') return;
    timerRef.current = setInterval(() => {
      setTimeLeft(t => { if (t<=1) { clearInterval(timerRef.current); handleSubmit(true); return 0; } return t-1; });
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, [loading]);

  const loadQuestions = async () => {
    // Offline: go straight to local cache, skip the network attempt entirely
    if (!navigator.onLine) {
      const cached = readOfflineCache(cacheKey);
      if (cached?.length) {
        let qs = cached;
        if (config.shuffle) qs = [...qs].sort(() => Math.random() - 0.5);
        setQuestions(qs.slice(0, config.count));
        setUsingOfflineCache(true);
        setLoading(false);
        return;
      }
      // Nothing saved for this exact subject/exam/year combo while offline
      setQuestions(makeDemoQuestions(config.subject, config.count));
      setUsingOfflineCache(true);
      setLoading(false);
      return;
    }

    try {
      const params = { limit: config.mode === 'adaptive' ? Math.min(config.count * 3, 240) : config.count };
      if (config.subject !== 'All') params.subject = config.subject;
      if (config.examType !== 'CUSTOM') params.exam_type = config.examType;
      if (config.year !== 'All Years') params.year = config.year;
      const res = await axios.get(`${API}/questions`, { params });
      let qs = (res.data.questions || []).map(q => ({ ...q, options: safeParseArray(q.options) }));

      if (config.mode === 'adaptive' && qs.length > 0) {
        const pool = { easy: [], medium: [], hard: [] };
        qs.forEach(q => { (pool[q.difficulty] || pool.medium).push(q); });
        Object.keys(pool).forEach(k => pool[k].sort(() => Math.random() - 0.5));
        poolRef.current = pool;
        const initial = [];
        for (let i = 0; i < config.count; i++) {
          const q = pool.medium.pop() || pool.easy.pop() || pool.hard.pop();
          if (q) initial.push(q);
        }
        writeOfflineCache(cacheKey, initial);
        setQuestions(initial);
        setLoading(false);
        return;
      }

      if (qs.length === 0) qs = makeDemoQuestions(config.subject, config.count);
      else writeOfflineCache(cacheKey, qs); // silently save for next time we're offline
      if (config.shuffle) qs = qs.sort(() => Math.random() - 0.5);
      setQuestions(qs.slice(0, config.count));
    } catch {
      // Network call failed even though navigator.onLine said true (flaky connection) — fall back to cache
      const cached = readOfflineCache(cacheKey);
      if (cached?.length) {
        setQuestions(cached.slice(0, config.count));
        setUsingOfflineCache(true);
      } else {
        setQuestions(makeDemoQuestions(config.subject, config.count));
      }
    } finally { setLoading(false); }
  };

  const makeDemoQuestions = (subject, n) => Array.from({length:Math.min(n,5)},(_,i)=>({
    id:`demo-${i}`, question_text:`[Demo] ${subject} Question ${i+1}. Add past questions via Admin → Import Questions.`,
    options:['Option A','Option B','Option C','Option D'], correct_answers:JSON.stringify(['Option A']),
    explanation:'Import real JAMB/WAEC questions via the admin panel.', marks:1,
  }));

  const selectAnswer = (qId, opt) => {
    if (submittedRef.current) return;
    const isNew = answers[qId] !== opt;
    setAnswers(a => ({ ...a, [qId]: opt }));
    if (isNew) setAttempts(a => a+1);
    if (config.mode !== 'mock') setRevealed(r => ({ ...r, [qId]: true }));
  };

  const handleSubmit = useCallback((auto=false) => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    clearInterval(timerRef.current);
    const score = questions.reduce((s,q) => {
      const correct = safeParseArray(q.correct_answers);
      const ans = answers[q.id];
      return ans && correct.map(c=>c.toLowerCase().trim()).includes(ans.toLowerCase().trim()) ? s+1 : s;
    }, 0);
    onFinish({ questions, answers, score, total: questions.length, auto });
  }, [questions, answers]);

  if (loading) return (
    <div style={{ minHeight:'100dvh', display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column', gap:16, background:'#F0F4F8' }}>
      <div style={{ width:40, height:40, border:'4px solid #E2E8F0', borderTop:'4px solid #2563EB', borderRadius:'50%', animation:'spin 0.7s linear infinite' }}/>
      <p style={{ color:'#64748B', fontFamily:"'Inter',sans-serif" }}>Loading {config.count} questions...</p>
    </div>
  );

  const q = questions[current];
  if (!q) return null;
  const opts = safeParseArray(q.options);
  const correctAnswers = safeParseArray(q.correct_answers).map(c=>c.toLowerCase().trim());
  const selected = answers[q.id];
  const isRevealed = revealed[q.id];
  const answered = Object.keys(answers).length;
  const isWarning = timeLeft < 300 && config.mode !== 'study';
  const isCritical = timeLeft < 60 && config.mode !== 'study';

  const paletteStatus = (i) => {
    const qq = questions[i];
    if (i === current) return 'current';
    if (bookmarked.has(qq?.id)) return 'bookmarked';
    if (answers[qq?.id]) return 'answered';
    return 'unanswered';
  };
  const palColors = { current:{bg:'#2563EB',color:'#fff',border:'#2563EB'}, answered:{bg:'#DCFCE7',color:'#16A34A',border:'#16A34A'}, bookmarked:{bg:'#FEF3C7',color:'#D97706',border:'#D97706'}, unanswered:{bg:'#fff',color:'#64748B',border:'#CBD5E1'} };

  return (
    <div style={{ minHeight:'100dvh', background:'#F0F4F8', fontFamily:"'Inter',sans-serif", display:'flex', flexDirection:'column' }}>

      {/* ── TOOLBAR ── */}
      <div style={{ background:'#1E3A5F', padding:'0 16px', display:'flex', alignItems:'center', gap:0, flexShrink:0, overflowX:'auto' }}>
        {[
          { icon:'⟵', label:'Log Out', action:() => onFinish({questions,answers,score:0,total:questions.length,cancelled:true}) },
          { icon:'🧮', label:'Calculator', action:() => setShowCalc(c=>!c) },
          { icon:'🔖', label:'Bookmark', action:() => setBookmarked(b=>{ const n=new Set(b); n.has(q.id)?n.delete(q.id):n.add(q.id); return n; }) },
          { icon:'💡', label:'Explanation', action:() => setRevealed(r=>({...r,[q.id]:true})) },
          { icon: lowData ? '🐢' : '📶', label: lowData ? 'Low Data' : 'Full Data', action: toggleLowData },
        ].map(btn => (
          <button key={btn.label} onClick={btn.action} style={{
            display:'flex', flexDirection:'column', alignItems:'center', gap:3,
            padding:'8px 16px', background: btn.label==='Low Data' ? 'rgba(255,255,255,0.12)' : 'transparent', border:'none',
            borderRight:'1px solid rgba(255,255,255,0.1)',
            color:'rgba(255,255,255,0.85)', cursor:'pointer', fontFamily:"'Inter',sans-serif",
            transition:'background 0.1s', whiteSpace:'nowrap', minWidth:70,
          }}
            onMouseOver={e=>e.currentTarget.style.background='rgba(255,255,255,0.1)'}
            onMouseOut={e=>e.currentTarget.style.background = btn.label==='Low Data' ? 'rgba(255,255,255,0.12)' : 'transparent'}
          >
            <span style={{ fontSize:16 }}>{btn.icon}</span>
            <span style={{ fontSize:10, fontWeight:600 }}>{btn.label}</span>
          </button>
        ))}
        <div style={{ flex:1 }}/>
        {config.mode === 'adaptive' && (
          <div style={{ padding:'4px 12px', display:'flex', alignItems:'center', gap:6, borderLeft:'1px solid rgba(255,255,255,0.1)', fontSize:11.5, fontWeight:700, whiteSpace:'nowrap', color: adaptiveDifficulty==='hard' ? '#FCA5A5' : adaptiveDifficulty==='easy' ? '#86EFAC' : '#93C5FD' }}>
            🎯 {adaptiveDifficulty.charAt(0).toUpperCase()+adaptiveDifficulty.slice(1)}
          </div>
        )}
        {(!isOnline || usingOfflineCache) && (
          <div style={{ padding:'4px 12px', display:'flex', alignItems:'center', gap:6, borderLeft:'1px solid rgba(255,255,255,0.1)', fontSize:11.5, color:'#FCD34D', fontWeight:600, whiteSpace:'nowrap' }}>
            📡 {!isOnline ? 'Offline' : 'Saved set'}
          </div>
        )}
        {/* Timer */}
        <div style={{ padding:'4px 16px', display:'flex', alignItems:'center', gap:8, borderLeft:'1px solid rgba(255,255,255,0.1)' }}>
          <span style={{ fontSize:13 }}>⏱</span>
          <span style={{ fontFamily:'monospace', fontSize:15, fontWeight:700, color: isCritical?'#FCA5A5':isWarning?'#FCD34D':'#fff' }}>
            {config.mode==='study' ? '∞' : formatTime(timeLeft)}
          </span>
        </div>
        <div style={{ padding:'4px 16px', borderLeft:'1px solid rgba(255,255,255,0.1)', color:'rgba(255,255,255,0.7)', fontSize:12 }}>
          Attempt: {attempts}/{config.count}
        </div>
      </div>

      {/* ── SUBJECT TAB ── */}
      <div style={{ background:'#fff', borderBottom:'2px solid #E2E8F0', padding:'0 16px', display:'flex', alignItems:'center', gap:0, flexShrink:0 }}>
        <div style={{ padding:'10px 20px', borderBottom:'3px solid #2563EB', color:'#2563EB', fontWeight:700, fontSize:13, marginBottom:-2 }}>{config.subject}</div>
        <div style={{ marginLeft:'auto', padding:'6px 16px', fontSize:12, color:'#64748B' }}>
          {config.examType} {config.year !== 'All Years' ? `· ${config.year}` : ''} · {config.mode.toUpperCase()}
        </div>
      </div>

      {/* ── MAIN CONTENT ── */}
      <div style={{ flex:1, display:'flex', overflow:'hidden' }}>

        {/* LEFT: Palette */}
        <div style={{ width:200, background:'#fff', borderRight:'1px solid #E2E8F0', overflowY:'auto', flexShrink:0, padding:'12px 10px' }}>
          <div style={{ fontSize:11, fontWeight:700, color:'#94A3B8', textTransform:'uppercase', letterSpacing:'0.08em', marginBottom:10, paddingLeft:4 }}>
            Questions
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:4 }}>
            {questions.map((_,i) => {
              const st = paletteStatus(i);
              const pc = palColors[st];
              return (
                <button key={i} onClick={() => setCurrent(i)} style={{
                  width:32, height:32, borderRadius:6, border:`1.5px solid ${pc.border}`,
                  background:pc.bg, color:pc.color, fontWeight:700, fontSize:11,
                  cursor:'pointer', transition:'all 0.1s', fontFamily:"'Inter',sans-serif",
                }}>{i+1}</button>
              );
            })}
          </div>
          {/* Legend */}
          <div style={{ marginTop:14, display:'flex', flexDirection:'column', gap:5 }}>
            {[['#16A34A','Answered'],['#2563EB','Current'],['#D97706','Bookmarked'],['#CBD5E1','Not Done']].map(([c,l])=>(
              <div key={l} style={{ display:'flex', alignItems:'center', gap:6, fontSize:10, color:'#64748B' }}>
                <div style={{ width:10, height:10, borderRadius:2, background:c }}/>
                {l}
              </div>
            ))}
          </div>
        </div>

        {/* RIGHT: Question */}
        <div style={{ flex:1, overflowY:'auto', padding:'20px 24px' }}>
          <div style={{ maxWidth:720, margin:'0 auto' }}>

            {/* Question header */}
            <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:14 }}>
              <span style={{ fontSize:12, fontWeight:700, color:'#2563EB', background:'#EFF6FF', padding:'3px 12px', borderRadius:20, border:'1px solid #BFDBFE' }}>Question {current+1} of {questions.length}</span>
              {bookmarked.has(q.id) && <span style={{ fontSize:11, fontWeight:700, color:'#D97706', background:'#FEF3C7', padding:'3px 10px', borderRadius:20 }}>🔖 Bookmarked</span>}
              {q.marks && <span style={{ fontSize:11, color:'#64748B' }}>{q.marks} mark{parseFloat(q.marks)>1?'s':''}</span>}
            </div>

            {/* Question text */}
            <div style={{ background:'#fff', border:'1px solid #E2E8F0', borderRadius:12, padding:'20px 22px', marginBottom:18, fontSize:15, lineHeight:1.85, color:'#1E293B', fontWeight:500, boxShadow:'0 1px 4px rgba(0,0,0,0.05)' }}>
              {q.question_text}
              {q.media_url && !lowData && (
                <img src={q.media_url} alt="Question diagram" style={{ display:'block', maxWidth:'100%', maxHeight:340, marginTop:14, borderRadius:10, border:'1px solid #E2E8F0' }} />
              )}
              {q.media_url && lowData && (
                <div style={{ marginTop:14, padding:'10px 14px', background:'#F1F5F9', borderRadius:10, border:'1px dashed #CBD5E1', fontSize:12.5, color:'#64748B' }}>
                  🖼️ Diagram hidden — Low Data mode is on
                </div>
              )}
            </div>

            {/* Options — radio style */}
            <div style={{ display:'flex', flexDirection:'column', gap:10, marginBottom:20 }}>
              {opts.map((opt, i) => {
                const isSelected = selected === opt;
                const isCorrect = correctAnswers.includes(opt.toLowerCase().trim());
                let bg='#fff', border='#CBD5E1', textColor='#374151', radioColor='#CBD5E1';
                if (isRevealed) {
                  if (isCorrect)        { bg='#F0FDF4'; border='#16A34A'; textColor='#15803D'; radioColor='#16A34A'; }
                  else if (isSelected)  { bg='#FEF2F2'; border='#EF4444'; textColor='#DC2626'; radioColor='#EF4444'; }
                } else if (isSelected)  { bg='#EFF6FF'; border='#2563EB'; textColor='#1D4ED8'; radioColor='#2563EB'; }

                return (
                  <button key={i} onClick={() => !submittedRef.current && selectAnswer(q.id, opt)} style={{
                    display:'flex', alignItems:'flex-start', gap:14, padding:'13px 16px',
                    background:bg, border:`1.5px solid ${border}`, borderRadius:10,
                    cursor:submittedRef.current?'default':'pointer', textAlign:'left', width:'100%',
                    transition:'all 0.12s', fontFamily:"'Inter',sans-serif",
                    boxShadow: isSelected && !isRevealed ? '0 2px 8px rgba(37,99,235,0.15)' : '0 1px 3px rgba(0,0,0,0.04)',
                  }}>
                    {/* Radio */}
                    <div style={{ width:20, height:20, borderRadius:'50%', border:`2px solid ${radioColor}`, background: isSelected||isRevealed&&isCorrect ? radioColor : '#fff', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, marginTop:1, transition:'all 0.12s' }}>
                      {(isSelected || (isRevealed && isCorrect)) && <div style={{ width:8, height:8, borderRadius:'50%', background:'#fff' }}/>}
                    </div>
                    {/* Letter */}
                    <span style={{ fontSize:13, fontWeight:800, color:radioColor, flexShrink:0, minWidth:16, marginTop:1 }}>{LETTERS[i]}</span>
                    {/* Text */}
                    <span style={{ fontSize:14, fontWeight: isSelected?600:400, color:textColor, lineHeight:1.6 }}>{opt}</span>
                    {isRevealed && isCorrect && <span style={{ marginLeft:'auto', fontSize:16, flexShrink:0 }}>✓</span>}
                    {isRevealed && isSelected && !isCorrect && <span style={{ marginLeft:'auto', fontSize:16, flexShrink:0 }}>✗</span>}
                  </button>
                );
              })}
            </div>

            {/* Explanation */}
            {isRevealed && q.explanation && (
              <div style={{ background:'#EFF6FF', border:'1px solid #BFDBFE', borderRadius:10, padding:'14px 16px', marginBottom:16, fontSize:13, color:'#1E40AF', lineHeight:1.7 }}>
                <div style={{ fontWeight:700, marginBottom:6 }}>💡 Explanation</div>
                {q.explanation}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── BOTTOM NAV ── */}
      <div style={{ background:'#fff', borderTop:'1px solid #E2E8F0', padding:'12px 24px', display:'flex', alignItems:'center', justifyContent:'center', gap:12, flexShrink:0 }}>
        <button onClick={() => setCurrent(c=>Math.max(0,c-1))} disabled={current===0}
          style={{ padding:'9px 24px', borderRadius:20, border:'1.5px solid #CBD5E1', background:'#fff', color:current===0?'#CBD5E1':'#374151', fontWeight:700, fontSize:13, cursor:current===0?'default':'pointer', fontFamily:"'Inter',sans-serif", transition:'all 0.12s' }}>
          ← Previous
        </button>

        <button onClick={() => !submittedRef.current && handleSubmit(false)}
          style={{ padding:'9px 28px', borderRadius:20, border:'2px solid #DC2626', background:'#FEF2F2', color:'#DC2626', fontWeight:700, fontSize:13, cursor:'pointer', fontFamily:"'Inter',sans-serif", transition:'all 0.12s' }}
          onMouseOver={e=>{e.currentTarget.style.background='#DC2626';e.currentTarget.style.color='#fff';}}
          onMouseOut={e=>{e.currentTarget.style.background='#FEF2F2';e.currentTarget.style.color='#DC2626';}}>
          Submit
        </button>

        <button onClick={() => setCurrent(c=>Math.min(questions.length-1,c+1))} disabled={current===questions.length-1}
          style={{ padding:'9px 24px', borderRadius:20, border:'1.5px solid #2563EB', background:'#EFF6FF', color:current===questions.length-1?'#CBD5E1':'#2563EB', fontWeight:700, fontSize:13, cursor:current===questions.length-1?'default':'pointer', fontFamily:"'Inter',sans-serif", transition:'all 0.12s' }}>
          Next →
        </button>
      </div>

      {showCalc && <SimpleCalc onClose={() => setShowCalc(false)} />}
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

// ── RESULTS ───────────────────────────────────────────────────
function ResultsScreen({ result, config, onRetry, onNew }) {
  const { score, total, questions, answers, cancelled } = result;
  const pct = total > 0 ? (score/total)*100 : 0;
  const passed = pct >= 50;
  const [tab, setTab] = useState('summary');

  const getGrade = p => {
    if (p>=90) return {g:'A1',label:'Excellent',c:'#16A34A'};
    if (p>=80) return {g:'B2',label:'Very Good',c:'#22C55E'};
    if (p>=75) return {g:'B3',label:'Good',c:'#2563EB'};
    if (p>=60) return {g:'C4',label:'Credit',c:'#7C3AED'};
    if (p>=50) return {g:'E8',label:'Pass',c:'#D97706'};
    return {g:'F9',label:'Fail',c:'#DC2626'};
  };
  const {g,label,c} = getGrade(pct);

  return (
    <div style={{ minHeight:'100dvh', background:'#F0F4F8', fontFamily:"'Inter',sans-serif" }}>
      <div style={{ background:'#1E3A5F', padding:'12px 24px', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
        <div style={{ color:'#fff', fontWeight:800, fontSize:16 }}>Session Results</div>
        <div style={{ display:'flex', gap:10 }}>
          <button onClick={onRetry} style={{ padding:'7px 18px', background:'rgba(255,255,255,0.15)', border:'1px solid rgba(255,255,255,0.3)', color:'#fff', borderRadius:20, cursor:'pointer', fontWeight:600, fontSize:13, fontFamily:"'Inter',sans-serif" }}>↩ Retry</button>
          <button onClick={onNew} style={{ padding:'7px 18px', background:'#2563EB', border:'none', color:'#fff', borderRadius:20, cursor:'pointer', fontWeight:700, fontSize:13, fontFamily:"'Inter',sans-serif" }}>New Session</button>
        </div>
      </div>

      <div style={{ maxWidth:760, margin:'0 auto', padding:'28px 16px 60px' }}>

        {/* Score hero */}
        <div style={{ background:`linear-gradient(135deg,${passed?'#16A34A':'#DC2626'},${passed?'#22C55E':'#EF4444'})`, borderRadius:16, padding:'28px', marginBottom:20, color:'#fff', textAlign:'center', boxShadow:`0 8px 32px ${passed?'rgba(22,163,74,0.3)':'rgba(220,38,38,0.3)'}` }}>
          <div style={{ fontSize:48, marginBottom:8 }}>{passed?'🎉':'📖'}</div>
          <div style={{ fontSize:56, fontWeight:900, letterSpacing:'-0.04em', lineHeight:1 }}>{pct.toFixed(1)}<span style={{ fontSize:24, opacity:0.7 }}>%</span></div>
          <div style={{ fontSize:20, fontWeight:700, marginTop:4 }}>Grade {g} — {label}</div>
          <div style={{ display:'flex', gap:24, justifyContent:'center', marginTop:16 }}>
            {[['✓ Correct',score,'rgba(255,255,255,0.2)'],['✗ Wrong',total-score,'rgba(255,255,255,0.2)'],['— Skipped',total-Object.keys(answers).length,'rgba(255,255,255,0.2)']].map(([k,v,bg])=>(
              <div key={k} style={{ textAlign:'center', padding:'8px 16px', background:bg, borderRadius:10 }}>
                <div style={{ fontSize:20, fontWeight:800 }}>{v}</div>
                <div style={{ fontSize:11, opacity:0.8 }}>{k}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display:'flex', background:'#fff', borderRadius:10, padding:4, marginBottom:16, gap:4, boxShadow:'0 1px 4px rgba(0,0,0,0.08)' }}>
          {[['summary','📊 Summary'],['review','📝 Review Answers']].map(([id,label])=>(
            <button key={id} onClick={()=>setTab(id)} style={{ flex:1, padding:'9px', border:'none', borderRadius:8, cursor:'pointer', background:tab===id?'#2563EB':'transparent', color:tab===id?'#fff':'#64748B', fontFamily:"'Inter',sans-serif", fontWeight:700, fontSize:13, transition:'all 0.15s' }}>{label}</button>
          ))}
        </div>

        {tab==='summary' && (
          <div style={{ background:'#fff', borderRadius:12, padding:'20px', boxShadow:'0 1px 4px rgba(0,0,0,0.08)' }}>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12 }}>
              {[['Score',`${score}/${total}`,c],['Percentage',`${pct.toFixed(2)}%`,c],['Grade',g,c],['Result',passed?'PASSED':'FAILED',passed?'#16A34A':'#DC2626'],['Subject',config.subject,'#1E293B'],['Exam',config.examType,'#1E293B'],['Mode',config.mode,'#1E293B'],['Year',config.year,'#1E293B']].map(([k,v,col])=>(
                <div key={k} style={{ padding:'12px', background:'#F8FAFC', borderRadius:9, border:'1px solid #E2E8F0' }}>
                  <div style={{ fontSize:10, fontWeight:700, color:'#94A3B8', textTransform:'uppercase', letterSpacing:'0.07em', marginBottom:4 }}>{k}</div>
                  <div style={{ fontSize:16, fontWeight:800, color:col }}>{v}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab==='review' && (
          <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
            {questions.map((q,i)=>{
              const opts = safeParseArray(q.options);
              const correct = safeParseArray(q.correct_answers).map(c=>c.toLowerCase().trim());
              const userAns = answers[q.id];
              const isOk = userAns && correct.includes(userAns.toLowerCase().trim());
              return (
                <div key={q.id} style={{ background:'#fff', border:`1.5px solid ${isOk?'#86EFAC':userAns?'#FCA5A5':'#E2E8F0'}`, borderRadius:12, padding:'16px 18px', boxShadow:'0 1px 4px rgba(0,0,0,0.05)' }}>
                  <div style={{ display:'flex', gap:8, marginBottom:10 }}>
                    <span style={{ fontSize:11, fontWeight:700, padding:'2px 10px', borderRadius:20, background:isOk?'#DCFCE7':userAns?'#FEE2E2':'#F1F5F9', color:isOk?'#16A34A':userAns?'#DC2626':'#64748B' }}>{isOk?'✓ Correct':userAns?'✗ Wrong':'— Skipped'}</span>
                    <span style={{ fontSize:11, color:'#94A3B8' }}>Q{i+1}</span>
                  </div>
                  <div style={{ fontSize:14, fontWeight:600, color:'#1E293B', marginBottom:10, lineHeight:1.6 }}>{q.question_text}</div>
                  <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
                    {opts.map((opt,oi)=>{
                      const isCrt = correct.includes(opt.toLowerCase().trim());
                      const isUsr = userAns===opt;
                      return (
                        <div key={oi} style={{ display:'flex', alignItems:'center', gap:8, padding:'7px 12px', borderRadius:8, fontSize:13, background:isCrt?'#F0FDF4':isUsr&&!isCrt?'#FEF2F2':'transparent' }}>
                          <span style={{ fontWeight:800, fontSize:11, color:'#94A3B8', minWidth:14 }}>{LETTERS[oi]}</span>
                          <span style={{ color:isCrt?'#16A34A':isUsr&&!isCrt?'#DC2626':'#374151' }}>{opt}</span>
                          {isCrt&&<span style={{ marginLeft:'auto' }}>✓</span>}
                          {isUsr&&!isCrt&&<span style={{ marginLeft:'auto' }}>✗</span>}
                        </div>
                      );
                    })}
                  </div>
                  {q.explanation&&(
                    <div style={{ marginTop:10, padding:'10px 14px', background:'#EFF6FF', borderRadius:8, fontSize:12, color:'#1E40AF', lineHeight:1.7 }}>
                      <b>💡 Explanation:</b> {q.explanation}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── ENTRY POINT ───────────────────────────────────────────────
export default function StudyApp() {
  const [phase,  setPhase]  = useState('setup');
  const [config, setConfig] = useState(null);
  const [result, setResult] = useState(null);

  if (phase==='setup')   return <SetupScreen onStart={cfg => { setConfig(cfg); setPhase('exam'); }} />;
  if (phase==='exam')    return <ExamScreen config={config} onFinish={r => { setResult(r); setPhase('results'); }} />;
  if (phase==='results') return <ResultsScreen result={result} config={config} onRetry={()=>setPhase('exam')} onNew={()=>{ setConfig(null); setPhase('setup'); }} />;
  return null;
}
