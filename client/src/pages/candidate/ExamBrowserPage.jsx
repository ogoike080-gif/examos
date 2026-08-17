import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { examAPI, proctorAPI } from '../../utils/api';
import { useAuthStore, useExamStore, useSocketStore } from '../../store';
import Calculator from './Calculator';

const LETTERS = ['A','B','C','D','E'];

function safeParseArray(val) {
  if (Array.isArray(val)) return val;
  if (!val) return [];
  try { const p = JSON.parse(val); return Array.isArray(p) ? p : []; } catch { return []; }
}

function formatTime(s) {
  const h = Math.floor(s/3600), m = Math.floor((s%3600)/60), sec = s%60;
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
}

export default function ExamBrowserPage() {
  const { examId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const { getSocket } = useSocketStore();
  const { currentSession, currentExam, questions, answers, currentQuestionIndex, flagged,
    timeRemaining, examStatus, initExam, setAnswer, toggleFlag, goToQuestion,
    nextQuestion, prevQuestion, startTimer, stopTimer, setExamStatus, reset } = useExamStore();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [showCalc, setShowCalc] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  const [tabViolations, setTabViolations] = useState(0);

  const submittedRef = useRef(false);
  const saveIntervalRef = useRef(null);
  const timeCheckRef = useRef(null);

  const q = questions[currentQuestionIndex];
  const opts = q ? safeParseArray(q.options) : [];
  const answered = Object.keys(answers).length;
  const isWarning = timeRemaining < 300;
  const isCritical = timeRemaining < 60;

  useEffect(() => {
    loadExam();
    document.addEventListener('visibilitychange', onVisibility);
    document.addEventListener('contextmenu', e => e.preventDefault());
    return () => {
      stopTimer();
      clearInterval(saveIntervalRef.current);
      clearInterval(timeCheckRef.current);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [examId]);

  const onVisibility = useCallback(() => {
    if (document.hidden) setTabViolations(v => v + 1);
  }, []);

  const loadExam = async () => {
    try {
      const res = await examAPI.startSession(examId, { platform: navigator.platform });
      const { session, exam, questions: qs, auto_submitted } = res.data;
      if (auto_submitted || session.status === 'submitted') {
        toast('Time expired — showing results', { icon:'⏰' });
        navigate(`/exam/result/${session.id}`);
        return;
      }
      const norm = (qs||[]).map(q => ({ ...q, options: safeParseArray(q.options) }));
      initExam(session, exam, norm);
      setLoading(false);
      const remaining = session.time_remaining_seconds || exam.duration_minutes * 60;
      useExamStore.setState({ timeRemaining: remaining });
      startTimer(() => handleExpired(session.id));
      saveIntervalRef.current = setInterval(() => {
        const sock = getSocket();
        if (sock) sock.emit('heartbeat', { session_id: session.id, exam_id: examId });
      }, 20000);
      timeCheckRef.current = setInterval(() => syncTime(session.id), 60000);
    } catch (err) {
      setLoadError(err.response?.data?.error || 'Failed to load exam');
      setLoading(false);
    }
  };

  const syncTime = async (sessionId) => {
    try {
      const res = await examAPI.checkTime(sessionId);
      if (res.data.status === 'submitted') { handleExpired(sessionId); return; }
      const local = useExamStore.getState().timeRemaining;
      if (Math.abs(local - res.data.time_remaining_seconds) > 10)
        useExamStore.setState({ timeRemaining: res.data.time_remaining_seconds });
    } catch {}
  };

  const handleExpired = useCallback(async (sessionId) => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    stopTimer();
    clearInterval(saveIntervalRef.current);
    clearInterval(timeCheckRef.current);
    setExamStatus('submitted');
    setSubmitting(true);
    toast('⏰ Time up — submitting...', { duration:3000 });
    try {
      const sid = sessionId || currentSession?.id;
      await examAPI.submit(sid);
      setTimeout(() => { reset(); navigate(`/exam/result/${sid}`); }, 1500);
    } catch {
      const sid = sessionId || currentSession?.id;
      setTimeout(() => { reset(); navigate(`/exam/result/${sid}`); }, 1500);
    }
  }, [currentSession, examId]);

  const handleAnswer = async (opt) => {
    if (!q || examStatus !== 'active') return;
    setAnswer(q.id, opt);
    try {
      const res = await examAPI.saveAnswer(currentSession.id, q.id, opt);
      if (res.data?.auto_submitted) handleExpired(currentSession.id);
    } catch {}
  };

  const handleSubmit = async () => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    setShowSubmitModal(false);
    setSubmitting(true);
    stopTimer();
    setExamStatus('submitted');
    try {
      await examAPI.submit(currentSession.id);
      reset();
      navigate(`/exam/result/${currentSession.id}`);
    } catch {
      toast.error('Submit failed — retrying...');
      submittedRef.current = false;
      setSubmitting(false);
      setExamStatus('active');
    }
  };

  const getQStatus = (idx) => {
    const qq = questions[idx];
    if (!qq) return 'empty';
    if (idx === currentQuestionIndex) return 'current';
    if (flagged.has(qq.id)) return 'flagged';
    if (answers[qq.id] !== undefined) return 'answered';
    return 'unanswered';
  };

  const qStatusStyle = (status) => {
    switch(status) {
      case 'current':    return { background:'var(--brand)', color:'#fff', border:'none' };
      case 'answered':   return { background:'var(--success-dim)', color:'var(--success)', border:'1px solid var(--success)' };
      case 'flagged':    return { background:'var(--warning-dim)', color:'var(--warning)', border:'1px solid var(--warning)' };
      default:           return { background:'var(--bg-raised)', color:'var(--text-muted)', border:'1px solid var(--border)' };
    }
  };

  if (loading) return (
    <div style={{ minHeight:'100dvh', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:16, background:'var(--bg-base)' }}>
      <div style={{ width:48, height:48, borderRadius:14, background:'linear-gradient(135deg,var(--brand-dark),var(--brand-light))', display:'flex', alignItems:'center', justifyContent:'center', fontSize:22, fontWeight:900, color:'#fff', boxShadow:'0 4px 20px var(--brand-glow)', animation:'float 2s ease-in-out infinite' }}>E</div>
      <div className="spinner" style={{ width:28, height:28 }}/>
      <p style={{ color:'var(--text-muted)', fontSize:14 }}>Loading your exam...</p>
    </div>
  );

  if (loadError) return (
    <div style={{ minHeight:'100dvh', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:16, background:'var(--bg-base)', padding:24 }}>
      <div style={{ fontSize:48 }}>⚠️</div>
      <h2 style={{ textAlign:'center' }}>Cannot Start Exam</h2>
      <p style={{ color:'var(--text-muted)', textAlign:'center', maxWidth:360, fontSize:14 }}>{loadError}</p>
      <button className="btn btn-secondary" onClick={() => navigate('/exam')}>← Back to Dashboard</button>
    </div>
  );

  if (!q) return null;

  return (
    <div style={{ minHeight:'100dvh', background:'var(--bg-base)', display:'flex', flexDirection:'column' }}>

      {/* ── TOP BAR ── */}
      <header style={{
        height:56, display:'flex', alignItems:'center', gap:12,
        padding:'0 16px',
        background:'var(--bg-glass)',
        backdropFilter:'blur(20px)',
        WebkitBackdropFilter:'blur(20px)',
        borderBottom:'1px solid var(--border)',
        position:'sticky', top:0, zIndex:50, flexShrink:0,
      }}>
        {/* Exam title */}
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:12, fontWeight:700, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
            {currentExam?.title}
          </div>
          <div style={{ fontSize:10, color:'var(--text-muted)', marginTop:1 }}>
            Q{currentQuestionIndex+1}/{questions.length} · {user?.full_name?.split(' ')[0]}
          </div>
        </div>

        {/* Timer */}
        <div style={{
          display:'flex', alignItems:'center', gap:6,
          padding:'6px 14px', borderRadius:'var(--r-full)',
          background: isCritical ? 'var(--danger-dim)' : isWarning ? 'var(--warning-dim)' : 'var(--bg-raised)',
          border: `1px solid ${isCritical ? 'var(--danger)' : isWarning ? 'var(--warning)' : 'var(--border)'}`,
          transition:'all var(--t-base)',
        }}>
          {isCritical && <span style={{ animation:'pulse 1s infinite', fontSize:12 }}>🔴</span>}
          {!isCritical && isWarning && <span style={{ fontSize:12 }}>🟡</span>}
          {!isWarning && <span style={{ fontSize:12 }}>⏱</span>}
          <span style={{
            fontFamily:'var(--font-mono)', fontSize:14, fontWeight:700,
            color: isCritical ? 'var(--danger)' : isWarning ? 'var(--warning)' : 'var(--text-primary)',
          }}>
            {examStatus === 'submitted' ? 'DONE' : formatTime(timeRemaining)}
          </span>
        </div>

        {/* Actions */}
        <button onClick={() => setShowCalc(c=>!c)} style={{
          width:34, height:34, borderRadius:'var(--r)',
          border:'1px solid var(--border-md)',
          background: showCalc ? 'var(--brand-dim)' : 'var(--bg-raised)',
          color: showCalc ? 'var(--brand-light)' : 'var(--text-secondary)',
          cursor:'pointer', fontSize:16,
          display:'flex', alignItems:'center', justifyContent:'center',
          transition:'all var(--t-fast)',
        }}>🧮</button>

        <button onClick={() => setShowPalette(p=>!p)} style={{
          width:34, height:34, borderRadius:'var(--r)',
          border:'1px solid var(--border-md)',
          background: showPalette ? 'var(--brand-dim)' : 'var(--bg-raised)',
          color: showPalette ? 'var(--brand-light)' : 'var(--text-secondary)',
          cursor:'pointer', fontSize:16,
          display:'flex', alignItems:'center', justifyContent:'center',
          transition:'all var(--t-fast)',
        }} title="Question palette">⊞</button>

        <button
          onClick={() => setShowSubmitModal(true)}
          disabled={submitting || examStatus !== 'active'}
          style={{
            padding:'7px 14px', borderRadius:'var(--r)',
            border:'none', background:'var(--brand)', color:'#fff',
            cursor:'pointer', fontSize:12, fontFamily:'var(--font-body)', fontWeight:700,
            transition:'all var(--t-fast)', opacity: examStatus !== 'active' ? 0.5 : 1,
            whiteSpace:'nowrap',
          }}
        >{submitting ? 'Submitting...' : 'Submit'}</button>
      </header>

      {/* ── QUESTION PALETTE (collapsible) ── */}
      {showPalette && (
        <div style={{
          background:'var(--bg-surface)',
          borderBottom:'1px solid var(--border)',
          padding:'12px 16px',
          animation:'fadeIn 0.2s both',
        }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
            <span style={{ fontSize:11, fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.07em' }}>
              Question Navigator
            </span>
            <div style={{ display:'flex', gap:10, fontSize:10, color:'var(--text-muted)' }}>
              <span style={{ color:'var(--success)' }}>■ Answered ({answered})</span>
              <span style={{ color:'var(--warning)' }}>■ Flagged ({flagged.size})</span>
              <span>■ Skipped ({questions.length - answered})</span>
            </div>
          </div>
          <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
            {questions.map((_,i) => {
              const st = getQStatus(i);
              return (
                <button key={i}
                  onClick={() => { goToQuestion(i); setShowPalette(false); }}
                  style={{
                    width:34, height:34, borderRadius:'var(--r-sm)',
                    fontFamily:'var(--font-mono)', fontSize:11, fontWeight:700,
                    cursor:'pointer', transition:'all var(--t-fast)',
                    ...qStatusStyle(st),
                  }}
                >{i+1}</button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── MAIN CONTENT ── */}
      <main style={{ flex:1, display:'flex', flexDirection:'column', overflow:'auto', padding:'0 0 80px' }}>
        <div style={{ maxWidth:720, margin:'0 auto', width:'100%', padding:'20px 16px' }}>

          {/* Question meta */}
          <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:16 }}>
            <span style={{
              padding:'3px 10px', borderRadius:'var(--r-full)',
              background:'var(--brand-dim)', color:'var(--brand-light)',
              fontSize:10, fontWeight:700, letterSpacing:'0.05em',
            }}>Q {currentQuestionIndex+1} of {questions.length}</span>
            {q.marks && <span style={{ padding:'3px 10px', borderRadius:'var(--r-full)', background:'var(--bg-raised)', color:'var(--text-muted)', fontSize:10, fontWeight:700 }}>{q.marks} mark{parseFloat(q.marks) > 1 ? 's' : ''}</span>}
            {flagged.has(q.id) && <span style={{ padding:'3px 10px', borderRadius:'var(--r-full)', background:'var(--warning-dim)', color:'var(--warning)', fontSize:10, fontWeight:700 }}>⚑ Flagged</span>}
          </div>

          {/* Question text */}
          <div style={{
            background:'var(--bg-surface)',
            border:'1px solid var(--border)',
            borderRadius:'var(--r-xl)',
            padding:'20px 20px',
            marginBottom:16,
            fontSize:16, lineHeight:1.75, fontWeight:500,
            color:'var(--text-primary)',
          }}>
            {q.question_text}
            {q.media_url && (
              <img
                src={q.media_url}
                alt="Question diagram"
                style={{ display:'block', maxWidth:'100%', maxHeight:360, marginTop:14, borderRadius:'var(--r-lg)', border:'1px solid var(--border)' }}
              />
            )}
          </div>

          {/* MCQ Options */}
          {['mcq','true_false','multi_answer'].includes(q.question_type) && (
            <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
              {opts.length === 0 && (
                <p style={{ color:'var(--text-muted)', fontSize:13, textAlign:'center', padding:20 }}>No options found. Contact your teacher.</p>
              )}
              {opts.map((opt, i) => {
                const selected = answers[q.id] === opt;
                return (
                  <button key={i}
                    onClick={() => examStatus === 'active' && handleAnswer(opt)}
                    style={{
                      display:'flex', alignItems:'center', gap:14,
                      padding:'14px 16px',
                      background: selected ? 'var(--brand-dim)' : 'var(--bg-surface)',
                      border: `1.5px solid ${selected ? 'var(--brand)' : 'var(--border-md)'}`,
                      borderRadius:'var(--r-lg)',
                      cursor: examStatus === 'active' ? 'pointer' : 'default',
                      textAlign:'left', width:'100%',
                      transition:'all var(--t-fast)',
                      transform: selected ? 'scale(1.005)' : 'scale(1)',
                      boxShadow: selected ? '0 0 0 3px var(--brand-dim)' : 'none',
                      WebkitTapHighlightColor:'transparent',
                    }}
                    onMouseOver={e => { if (!selected && examStatus === 'active') { e.currentTarget.style.background='var(--bg-raised)'; e.currentTarget.style.borderColor='var(--border-lg)'; }}}
                    onMouseOut={e => { if (!selected) { e.currentTarget.style.background='var(--bg-surface)'; e.currentTarget.style.borderColor='var(--border-md)'; }}}
                  >
                    <div style={{
                      width:32, height:32, borderRadius:9, flexShrink:0,
                      background: selected ? 'var(--brand)' : 'var(--bg-raised)',
                      border: `1.5px solid ${selected ? 'var(--brand)' : 'var(--border-md)'}`,
                      display:'flex', alignItems:'center', justifyContent:'center',
                      fontFamily:'var(--font-display)', fontSize:13, fontWeight:800,
                      color: selected ? '#fff' : 'var(--text-muted)',
                      transition:'all var(--t-fast)',
                    }}>{LETTERS[i]}</div>
                    <span style={{ fontSize:14, fontWeight: selected ? 600 : 400, color: selected ? 'var(--brand-light)' : 'var(--text-primary)', lineHeight:1.5 }}>{opt}</span>
                    {selected && <span style={{ marginLeft:'auto', fontSize:16 }}>✓</span>}
                  </button>
                );
              })}
            </div>
          )}

          {/* Essay */}
          {(q.question_type === 'essay' || q.question_type === 'coding') && (
            <textarea
              placeholder={q.question_type === 'coding' ? '// Write your code here...' : 'Write your answer here...'}
              value={answers[q.id] || ''}
              onChange={e => examStatus === 'active' && handleAnswer(e.target.value)}
              disabled={examStatus !== 'active'}
              rows={10}
              style={{ fontFamily: q.question_type === 'coding' ? 'var(--font-mono)' : 'var(--font-body)', fontSize:14 }}
            />
          )}

          {/* Fill blank */}
          {q.question_type === 'fill_blank' && (
            <input
              type="text" placeholder="Type your answer here..."
              value={answers[q.id] || ''}
              onChange={e => examStatus === 'active' && handleAnswer(e.target.value)}
              disabled={examStatus !== 'active'}
            />
          )}
        </div>
      </main>

      {/* ── BOTTOM NAV ── */}
      <div style={{
        position:'fixed', bottom:0, left:0, right:0,
        background:'var(--bg-glass)',
        backdropFilter:'blur(20px)',
        WebkitBackdropFilter:'blur(20px)',
        borderTop:'1px solid var(--border)',
        padding:'10px 16px',
        paddingBottom:'calc(10px + env(safe-area-inset-bottom))',
        display:'flex', alignItems:'center', gap:10, zIndex:40,
      }}>
        <button className="btn btn-secondary" onClick={prevQuestion} disabled={currentQuestionIndex === 0}
          style={{ flex:1, justifyContent:'center' }}>← Prev</button>

        <button
          onClick={() => toggleFlag(q.id)}
          style={{
            width:44, height:44, borderRadius:'var(--r)',
            border:`1px solid ${flagged.has(q.id) ? 'var(--warning)' : 'var(--border)'}`,
            background: flagged.has(q.id) ? 'var(--warning-dim)' : 'var(--bg-raised)',
            color: flagged.has(q.id) ? 'var(--warning)' : 'var(--text-muted)',
            cursor:'pointer', fontSize:16, flexShrink:0,
            display:'flex', alignItems:'center', justifyContent:'center',
            transition:'all var(--t-fast)',
          }}
        >⚑</button>

        {currentQuestionIndex === questions.length - 1 ? (
          <button className="btn btn-primary" onClick={() => setShowSubmitModal(true)}
            disabled={submitting || examStatus !== 'active'}
            style={{ flex:1, justifyContent:'center' }}>
            Submit Exam ✓
          </button>
        ) : (
          <button className="btn btn-primary" onClick={nextQuestion} style={{ flex:1, justifyContent:'center' }}>
            Next →
          </button>
        )}
      </div>

      {/* ── SUBMIT MODAL ── */}
      {showSubmitModal && (
        <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && setShowSubmitModal(false)}>
          <div className="modal" style={{ maxWidth:400 }}>
            <div className="modal-header">
              <h3>Submit Exam?</h3>
              <button onClick={() => setShowSubmitModal(false)} style={{ background:'var(--bg-raised)', border:'1px solid var(--border)', borderRadius:'var(--r)', width:30, height:30, cursor:'pointer', color:'var(--text-secondary)', fontSize:14, display:'flex', alignItems:'center', justifyContent:'center' }}>✕</button>
            </div>
            <div className="modal-body">
              <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                {[
                  ['Answered', answered, questions.length, 'var(--success)'],
                  ['Unanswered', questions.length - answered, questions.length, questions.length - answered > 0 ? 'var(--warning)' : 'var(--success)'],
                  ['Flagged', flagged.size, questions.length, 'var(--warning)'],
                ].map(([label, val, total, color]) => (
                  <div key={label} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'10px 14px', background:'var(--bg-raised)', borderRadius:'var(--r)', border:'1px solid var(--border)' }}>
                    <span style={{ fontSize:13, color:'var(--text-secondary)' }}>{label}</span>
                    <span style={{ fontFamily:'var(--font-display)', fontSize:16, fontWeight:800, color }}>{val}<span style={{ fontSize:12, color:'var(--text-muted)', fontFamily:'var(--font-body)' }}>/{total}</span></span>
                  </div>
                ))}
                <div style={{ padding:'12px 14px', background:'var(--warning-dim)', border:'1px solid var(--warning)', borderRadius:'var(--r)', fontSize:13, color:'var(--text-primary)' }}>
                  ⚠ Once submitted, you cannot return to this exam.
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowSubmitModal(false)}>Continue Exam</button>
              <button className="btn btn-primary" onClick={handleSubmit} disabled={submitting}>
                {submitting ? <><span className="spinner"/>Submitting...</> : 'Yes, Submit Final ✓'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tab violation warning */}
      {tabViolations > 0 && (
        <div style={{
          position:'fixed', top:64, left:'50%', transform:'translateX(-50%)',
          background:'var(--danger-dim)', border:'1px solid var(--danger)',
          borderRadius:'var(--r-full)', padding:'6px 16px',
          fontSize:12, fontWeight:700, color:'var(--danger)', zIndex:60,
          animation:'fadeIn 0.3s both', whiteSpace:'nowrap',
        }}>
          ⚠ Tab switch detected ({tabViolations})
        </div>
      )}

      {showCalc && <Calculator onClose={() => setShowCalc(false)} />}
    </div>
  );
}
