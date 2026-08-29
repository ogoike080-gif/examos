import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { examAPI, questionAPI } from '../../utils/api';
import Button from '../../components/shared/Button';
import MathText from '../../components/MathText';

export default function ExamBuilderPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isEdit = !!id;

  const [subjects, setSubjects] = useState([]);
  const [allQuestions, setAllQuestions] = useState([]);
  // Exam mode is strictly objective — matches the same exclusion the
  // backend enforces in POST /api/exams, kept here too so the picker never
  // even offers an essay/theory question in the first place.
  const objectiveQuestions = allQuestions.filter(q => q.question_type !== 'essay');
  const [selectedQIds, setSelectedQIds] = useState([]);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState('details'); // details | questions | settings

  const [form, setForm] = useState({
    title: '', description: '', subject_id: '', exam_type: 'WAEC',
    duration_minutes: 60, total_marks: 100, pass_marks: 50,
    instructions: 'Answer all questions. No cheating. Ensure your camera is on.',
    settings: {
      shuffle_questions: true, shuffle_options: true,
      show_timer: true, allow_back: true, auto_submit: true,
      proctoring: { face_detection: true, gaze_tracking: true, audio_monitoring: true, tab_monitoring: true, screenshot_blocking: true }
    },
    scheduled_at: '',
  });

  useEffect(() => {
    questionAPI.subjects().then(r => setSubjects(r.data.subjects || []));
    questionAPI.list({ limit: 100 }).then(r => setAllQuestions(r.data.questions || []));
    if (isEdit) loadExam();
  }, [id]);

  const loadExam = async () => {
    try {
      const res = await examAPI.get(id);
      const e = res.data.exam;
      setForm(f => ({
        ...f,
        title: e.title, description: e.description, subject_id: e.subject_id,
        exam_type: e.exam_type, duration_minutes: e.duration_minutes,
        total_marks: e.total_marks, pass_marks: e.pass_marks,
        instructions: e.instructions,
        settings: JSON.parse(e.settings || '{}'),
        scheduled_at: e.scheduled_at?.slice(0,16) || '',
      }));
      if (e.questions) setSelectedQIds(e.questions.map(q => q.id));
    } catch { toast.error('Failed to load exam'); }
  };

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }));
  const setSetting = (key, val) => setForm(f => ({ ...f, settings: { ...f.settings, [key]: val } }));
  const setProctoring = (key, val) => setForm(f => ({
    ...f, settings: { ...f.settings, proctoring: { ...f.settings.proctoring, [key]: val } }
  }));

  const toggleQuestion = (qId) => {
    setSelectedQIds(ids => ids.includes(qId) ? ids.filter(i => i !== qId) : [...ids, qId]);
  };

  const handleSave = async () => {
    if (!form.title) return toast.error('Exam title required');
    if (selectedQIds.length === 0) return toast.error('Add at least one question');
    setSaving(true);
    try {
      const payload = { ...form, question_ids: selectedQIds };
      let res;
      if (isEdit) {
        res = await examAPI.update(id, payload);
        toast.success('Exam updated');
      } else {
        res = await examAPI.create(payload);
        toast.success('Exam created');
      }
      // Exam mode is objective-only — the backend silently drops any essay/
      // theory questions from the set attached to the exam, since they can't
      // be auto-graded within a timed session. Surface that here so it's
      // not a silent surprise if some were selected.
      if (res.data?.excluded_essay_count) {
        toast(`${res.data.excluded_essay_count} essay/theory question(s) were left out — exam mode only features objective questions. They're still available in Practice Mode.`, { icon: 'ℹ️', duration: 6000 });
      }
      navigate('/admin/exams');
    } catch (err) { toast.error(err.response?.data?.error || 'Save failed'); }
    finally { setSaving(false); }
  };

  const s = { padding:'28px 32px' };
  const h1s = { fontFamily:'var(--font-display)', fontSize:24, fontWeight:800, letterSpacing:'-0.03em' };
  const cardS = { background:'var(--bg-surface)', border:'1px solid var(--border)', borderRadius:'var(--r-lg)', overflow:'hidden', marginBottom:16 };
  const cardHeadS = { padding:'14px 18px', borderBottom:'1px solid var(--border)', fontFamily:'var(--font-display)', fontSize:14, fontWeight:700 };
  const cardBodyS = { padding:18 };
  const fieldS = { marginBottom:14 };
  const labelS = { display:'block', fontSize:11, fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:5 };
  const gridS = { display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 };
  const tabBtnS = (active) => ({
    padding:'7px 18px', border:`1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
    background: active ? 'var(--accent-dim)' : 'transparent',
    color: active ? 'var(--accent)' : 'var(--text-secondary)',
    borderRadius:20, fontFamily:'var(--font-body)', fontSize:13, fontWeight:600, cursor:'pointer'
  });
  const checkRowS = { display:'flex', alignItems:'center', gap:8, fontSize:13, color:'var(--text-secondary)', cursor:'pointer', padding:'4px 0' };

  return (
    <div style={s}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:20 }}>
        <div>
          <h1 style={h1s}>{isEdit ? 'Edit Exam' : 'Create Exam'}</h1>
          <p style={{ fontSize:13, color:'var(--text-secondary)', marginTop:3 }}>
            {selectedQIds.length} question{selectedQIds.length !== 1 ? 's' : ''} selected
          </p>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <Button variant="ghost" onClick={() => navigate('/admin/exams')}>Cancel</Button>
          <Button onClick={handleSave} loading={saving}>{isEdit ? 'Update Exam' : 'Create Exam'}</Button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display:'flex', gap:6, marginBottom:20 }}>
        {['details', 'questions', 'settings'].map(t => (
          <button key={t} style={tabBtnS(tab === t)} onClick={() => setTab(t)}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
            {t === 'questions' && ` (${selectedQIds.length})`}
          </button>
        ))}
      </div>

      {/* DETAILS TAB */}
      {tab === 'details' && (
        <div style={{ maxWidth:700 }}>
          <div style={cardS}>
            <div style={cardHeadS}>Exam Details</div>
            <div style={cardBodyS}>
              <div style={fieldS}>
                <label style={labelS}>Exam Title</label>
                <input placeholder="e.g. WAEC Mathematics 2026" value={form.title} onChange={e => set('title', e.target.value)} />
              </div>
              <div style={{ ...gridS, marginBottom:14 }}>
                <div>
                  <label style={labelS}>Subject</label>
                  <select value={form.subject_id} onChange={e => set('subject_id', e.target.value)}>
                    <option value="">Select subject...</option>
                    {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <div>
                  <label style={labelS}>Exam Type</label>
                  <select value={form.exam_type} onChange={e => set('exam_type', e.target.value)}>
                    {['WAEC','JAMB','NECO','Post-UTME','General','Custom'].map(t => <option key={t}>{t}</option>)}
                  </select>
                </div>
              </div>
              <div style={{ ...gridS, marginBottom:14 }}>
                <div>
                  <label style={labelS}>Duration (minutes)</label>
                  <input type="number" min={10} max={300} value={form.duration_minutes} onChange={e => set('duration_minutes', Number(e.target.value))} />
                </div>
                <div>
                  <label style={labelS}>Scheduled At</label>
                  <input type="datetime-local" value={form.scheduled_at} onChange={e => set('scheduled_at', e.target.value)} />
                </div>
              </div>
              <div style={gridS}>
                <div>
                  <label style={labelS}>Total Marks</label>
                  <input type="number" value={form.total_marks} onChange={e => set('total_marks', Number(e.target.value))} />
                </div>
                <div>
                  <label style={labelS}>Pass Mark</label>
                  <input type="number" value={form.pass_marks} onChange={e => set('pass_marks', Number(e.target.value))} />
                </div>
              </div>
            </div>
          </div>
          <div style={cardS}>
            <div style={cardHeadS}>Instructions to Candidates</div>
            <div style={cardBodyS}>
              <textarea rows={4} value={form.instructions} onChange={e => set('instructions', e.target.value)} />
            </div>
          </div>
        </div>
      )}

      {/* QUESTIONS TAB */}
      {tab === 'questions' && (
        <div>
          <div style={{ marginBottom:12, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            <span style={{ fontSize:13, color:'var(--text-secondary)' }}>{selectedQIds.length} selected · {objectiveQuestions.length} available</span>
            <Button size="sm" variant="ghost" onClick={() => setSelectedQIds(objectiveQuestions.map(q => q.id))}>Select All</Button>
          </div>
          <div style={{
            marginBottom:12, padding:'10px 14px', background:'var(--accent-dim)',
            border:'1px solid rgba(245,166,35,0.2)', borderRadius:'var(--r)',
            fontSize:12, color:'var(--text-secondary)', lineHeight:1.6,
          }}>
            ℹ️ Only objective questions are shown — exam mode is auto-graded and timed, so essay/theory questions aren't available here. They're still fully usable in Practice Mode.
          </div>
          <div style={{ background:'var(--bg-surface)', border:'1px solid var(--border)', borderRadius:'var(--r-lg)', overflow:'hidden', maxHeight:500, overflowY:'auto' }}>
            {objectiveQuestions.map(q => {
              const opts = (() => { try { return JSON.parse(q.options||'[]'); } catch { return []; } })();
              const sel = selectedQIds.includes(q.id);
              return (
                <div key={q.id} onClick={() => toggleQuestion(q.id)} style={{
                  display:'flex', alignItems:'flex-start', gap:12, padding:'12px 16px',
                  borderBottom:'1px solid var(--border)', cursor:'pointer',
                  background: sel ? 'var(--accent-dim)' : 'transparent', transition:'background 0.1s'
                }}>
                  <input type="checkbox" checked={sel} readOnly style={{ marginTop:3, width:'auto' }} />
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:13, fontWeight:500, marginBottom:6, lineHeight:1.4 }}><MathText text={q.question_text} inline /></div>
                    <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                      <span className={`tag tag-${q.difficulty === 'easy' ? 'green' : q.difficulty === 'hard' ? 'red' : 'amber'}`}>{q.difficulty}</span>
                      <span className="tag tag-gray">{q.question_type}</span>
                      {q.subject_name && <span className="tag tag-blue">{q.subject_name}</span>}
                      <span style={{ fontSize:11, color:'var(--text-muted)' }}>{q.marks} mark{q.marks !== 1 ? 's' : ''}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* SETTINGS TAB */}
      {tab === 'settings' && (
        <div style={{ maxWidth:600 }}>
          <div style={cardS}>
            <div style={cardHeadS}>Exam Behaviour</div>
            <div style={cardBodyS}>
              {[
                ['shuffle_questions', 'Randomise question order per candidate'],
                ['shuffle_options', 'Randomise answer options per question'],
                ['show_timer', 'Show countdown timer to candidate'],
                ['allow_back', 'Allow navigating back to previous questions'],
                ['auto_submit', 'Auto-submit when time expires'],
              ].map(([key, label]) => (
                <label key={key} style={checkRowS}>
                  <input type="checkbox" style={{ width:'auto' }} checked={!!form.settings[key]}
                    onChange={e => setSetting(key, e.target.checked)} />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </div>
          <div style={cardS}>
            <div style={cardHeadS}>AI Proctoring</div>
            <div style={cardBodyS}>
              {[
                ['face_detection', 'Face detection & identity verification'],
                ['gaze_tracking', 'Eye/gaze tracking & off-screen alerts'],
                ['audio_monitoring', 'Audio monitoring for suspicious sounds'],
                ['tab_monitoring', 'Tab switch & window blur detection'],
                ['screenshot_blocking', 'Block screenshots & screen recording'],
              ].map(([key, label]) => (
                <label key={key} style={checkRowS}>
                  <input type="checkbox" style={{ width:'auto' }} checked={!!form.settings.proctoring?.[key]}
                    onChange={e => setProctoring(key, e.target.checked)} />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
