import React, { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { syllabusAPI } from '../../utils/api';

const cardS = { background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-xl)', padding: '14px' };
const inputS = { width: '100%', padding: '8px 10px', borderRadius: 'var(--r)', border: '1.5px solid var(--border-md)', background: 'var(--bg-raised)', color: 'var(--text-primary)', fontFamily: 'var(--font-body)', fontSize: 13 };
const colHeaderS = { fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' };
const itemS = (active) => ({
  padding: '9px 10px', borderRadius: 'var(--r)', cursor: 'pointer', fontSize: 13, marginBottom: 4,
  background: active ? 'color-mix(in srgb, var(--brand-light) 14%, transparent)' : 'transparent',
  color: active ? 'var(--brand-light)' : 'var(--text-secondary)', fontWeight: active ? 700 : 500,
  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
});
const addBtnS = { background: 'none', border: 'none', color: 'var(--brand-light)', fontWeight: 700, fontSize: 18, cursor: 'pointer', lineHeight: 1, padding: '0 4px' };
const delBtnS = { background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer', opacity: 0.6 };

export default function ExamBodyManagerPage() {
  const [examBodies, setExamBodies] = useState([]);
  const [examinations, setExaminations] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [topics, setTopics] = useState([]);

  const [selectedBody, setSelectedBody] = useState(null);
  const [selectedExam, setSelectedExam] = useState(null);
  const [selectedSubject, setSelectedSubject] = useState(null);
  const [selectedTopic, setSelectedTopic] = useState(null);

  const [topicDetail, setTopicDetail] = useState(null);
  const [content, setContent] = useState(null);
  const [contentDraft, setContentDraft] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => { loadExamBodies(); }, []);
  useEffect(() => { if (selectedBody) loadExaminations(selectedBody.id); else { setExaminations([]); setSelectedExam(null); } }, [selectedBody]);
  useEffect(() => { if (selectedExam) loadSubjects(selectedExam.id); else { setSubjects([]); setSelectedSubject(null); } }, [selectedExam]);
  useEffect(() => { if (selectedSubject) loadTopics(selectedSubject.id); else { setTopics([]); setSelectedTopic(null); } }, [selectedSubject]);
  useEffect(() => { if (selectedTopic) loadTopicDetail(selectedTopic.id); else { setTopicDetail(null); setContent(null); } }, [selectedTopic]);

  const loadExamBodies = () => syllabusAPI.examBodies().then(r => setExamBodies(r.data.exam_bodies || [])).catch(() => toast.error('Could not load exam bodies'));
  const loadExaminations = (id) => syllabusAPI.examinations(id).then(r => setExaminations(r.data.examinations || []));
  const loadSubjects = (id) => syllabusAPI.subjects(id).then(r => setSubjects(r.data.subjects || []));
  const loadTopics = (id) => syllabusAPI.topics(id).then(r => setTopics(r.data.topics || []));
  const loadTopicDetail = async (id) => {
    const [detailRes, contentRes] = await Promise.all([syllabusAPI.getTopic(id), syllabusAPI.getContent(id)]);
    setTopicDetail(detailRes.data);
    setContent(contentRes.data.content);
    setContentDraft(contentRes.data.content ? { ...contentRes.data.content } : null);
  };

  // ── Add handlers (simple prompt-based add — keeps this page from ballooning
  // into a modal system; fine for admin-only, low-frequency structural edits) ──
  const addExamBody = async () => {
    const name = window.prompt('Exam body name (e.g. WAEC):'); if (!name) return;
    const code = window.prompt('Short code (e.g. WAEC):', name.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 10)); if (!code) return;
    try { await syllabusAPI.createExamBody({ name, code }); toast.success('Exam body added'); loadExamBodies(); }
    catch (err) { toast.error(err.response?.data?.error || 'Failed'); }
  };
  const addExamination = async () => {
    const name = window.prompt('Examination name (e.g. WASSCE):'); if (!name) return;
    const code = window.prompt('Short code:', name.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 10)); if (!code) return;
    try { await syllabusAPI.createExamination(selectedBody.id, { name, code }); toast.success('Examination added'); loadExaminations(selectedBody.id); }
    catch (err) { toast.error(err.response?.data?.error || 'Failed'); }
  };
  const addSubject = async () => {
    const name = window.prompt('Subject name (e.g. Mathematics):'); if (!name) return;
    try { await syllabusAPI.createSubject(selectedExam.id, { name }); toast.success('Subject added'); loadSubjects(selectedExam.id); }
    catch (err) { toast.error(err.response?.data?.error || 'Failed'); }
  };
  const addTopic = async () => {
    const name = window.prompt('Topic name (e.g. Algebra):'); if (!name) return;
    try { await syllabusAPI.createTopic(selectedSubject.id, { name }); toast.success('Topic added'); loadTopics(selectedSubject.id); }
    catch (err) { toast.error(err.response?.data?.error || 'Failed'); }
  };
  const addSubtopic = async () => {
    const name = window.prompt('Subtopic name:'); if (!name) return;
    try { await syllabusAPI.createSubtopic(selectedTopic.id, { name }); toast.success('Subtopic added'); loadTopicDetail(selectedTopic.id); }
    catch { toast.error('Failed'); }
  };

  const del = async (fn, id, reload) => {
    if (!window.confirm('Delete this? Everything nested under it goes too.')) return;
    try { await fn(id); toast.success('Deleted'); reload(); }
    catch { toast.error('Delete failed'); }
  };

  const generateContent = async () => {
    setGenerating(true);
    try {
      await syllabusAPI.generateContent(selectedTopic.id);
      toast.success('AI draft generated — review and edit below before publishing');
      loadTopicDetail(selectedTopic.id);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Generation failed');
    } finally {
      setGenerating(false);
    }
  };

  const saveContent = async (publish) => {
    setSaving(true);
    try {
      await syllabusAPI.saveContent(selectedTopic.id, { ...contentDraft, publish });
      toast.success(publish ? 'Published — students can now see this' : 'Draft saved');
      loadTopicDetail(selectedTopic.id);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const field = (key, label, rows = 3) => (
    <div style={{ marginBottom: 10 }}>
      <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase' }}>{label}</label>
      <textarea
        style={{ ...inputS, minHeight: rows * 20 }}
        value={contentDraft?.[key] || ''}
        onChange={e => setContentDraft(d => ({ ...d, [key]: e.target.value }))}
      />
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <h1 style={{ fontSize: '1.5rem', marginBottom: 4 }}>Exam Body Manager</h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          Build the Exam Body → Examination → Subject → Topic structure that powers Read by Topic. Subjects here are separate from the Question Bank's subject list — link one below to pull real CBT practice questions into a topic once that's wired up.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        {/* Exam Bodies */}
        <div style={cardS}>
          <div style={colHeaderS}><span>Exam Bodies</span><button style={addBtnS} onClick={addExamBody}>+</button></div>
          {examBodies.map(b => (
            <div key={b.id} style={itemS(selectedBody?.id === b.id)} onClick={() => { setSelectedBody(b); setSelectedExam(null); setSelectedSubject(null); setSelectedTopic(null); }}>
              <span>{b.name}</span>
              <button style={delBtnS} onClick={e => { e.stopPropagation(); del(syllabusAPI.deleteExamBody, b.id, loadExamBodies); }}>✕</button>
            </div>
          ))}
          {examBodies.length === 0 && <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>No exam bodies yet.</p>}
        </div>

        {/* Examinations */}
        <div style={cardS}>
          <div style={colHeaderS}><span>Examinations</span>{selectedBody && <button style={addBtnS} onClick={addExamination}>+</button>}</div>
          {!selectedBody ? <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Select an exam body</p> : examinations.map(e => (
            <div key={e.id} style={itemS(selectedExam?.id === e.id)} onClick={() => { setSelectedExam(e); setSelectedSubject(null); setSelectedTopic(null); }}>
              <span>{e.name}</span>
              <button style={delBtnS} onClick={ev => { ev.stopPropagation(); del(syllabusAPI.deleteExamination, e.id, () => loadExaminations(selectedBody.id)); }}>✕</button>
            </div>
          ))}
        </div>

        {/* Subjects */}
        <div style={cardS}>
          <div style={colHeaderS}><span>Subjects</span>{selectedExam && <button style={addBtnS} onClick={addSubject}>+</button>}</div>
          {!selectedExam ? <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Select an examination</p> : subjects.map(s => (
            <div key={s.id} style={itemS(selectedSubject?.id === s.id)} onClick={() => { setSelectedSubject(s); setSelectedTopic(null); }}>
              <span>{s.name}</span>
              <button style={delBtnS} onClick={ev => { ev.stopPropagation(); del(syllabusAPI.deleteSubject, s.id, () => loadSubjects(selectedExam.id)); }}>✕</button>
            </div>
          ))}
        </div>

        {/* Topics */}
        <div style={cardS}>
          <div style={colHeaderS}><span>Topics</span>{selectedSubject && <button style={addBtnS} onClick={addTopic}>+</button>}</div>
          {!selectedSubject ? <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Select a subject</p> : topics.map(t => (
            <div key={t.id} style={itemS(selectedTopic?.id === t.id)} onClick={() => setSelectedTopic(t)}>
              <span>
                {t.name}
                {t.content_status === 'published' && <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--success)' }}>●</span>}
                {t.content_status === 'draft' && <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--warning)' }}>●</span>}
              </span>
              <button style={delBtnS} onClick={ev => { ev.stopPropagation(); del(syllabusAPI.deleteTopic, t.id, () => loadTopics(selectedSubject.id)); }}>✕</button>
            </div>
          ))}
        </div>
      </div>

      {/* Topic content editor */}
      {selectedTopic && topicDetail && (
        <div style={{ ...cardS, padding: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
            <div>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>
                {topicDetail.topic.exam_body_name} → {topicDetail.topic.examination_name} → {topicDetail.topic.subject_name}
              </p>
              <h2 style={{ fontSize: '1.2rem' }}>{topicDetail.topic.name}</h2>
            </div>
            <span style={{
              padding: '3px 12px', borderRadius: 'var(--r-full)', fontWeight: 700, fontSize: 11,
              background: content?.status === 'published' ? 'var(--success-dim)' : 'var(--warning-dim)',
              color: content?.status === 'published' ? 'var(--success)' : 'var(--warning)',
            }}>
              {content ? (content.status === 'published' ? 'Published' : 'Draft — not visible to students') : 'No content yet'}
            </span>
          </div>

          {/* Subtopics */}
          <div style={{ marginBottom: 16 }}>
            <div style={colHeaderS}><span>Subtopics</span><button style={addBtnS} onClick={addSubtopic}>+</button></div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {topicDetail.subtopics.map(st => (
                <span key={st.id} style={{ padding: '4px 10px', background: 'var(--bg-raised)', borderRadius: 'var(--r-full)', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                  {st.name}
                  <button style={{ ...delBtnS, fontSize: 10 }} onClick={() => del(syllabusAPI.deleteSubtopic, st.id, () => loadTopicDetail(selectedTopic.id))}>✕</button>
                </span>
              ))}
              {topicDetail.subtopics.length === 0 && <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>None yet</p>}
            </div>
          </div>

          {!content ? (
            <button onClick={generateContent} disabled={generating}
              style={{ padding: '10px 20px', borderRadius: 'var(--r-lg)', border: 'none', background: 'var(--brand-light)', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>
              {generating ? 'Generating…' : '✨ Generate Content with AI'}
            </button>
          ) : (
            <>
              {content.status === 'draft' && (
                <div style={{ marginBottom: 12, padding: 10, background: 'var(--warning-dim)', borderRadius: 'var(--r)', fontSize: 12, color: 'var(--warning)' }}>
                  ⚠ This is an AI-generated draft. Review and edit every field for accuracy before publishing — students will never see this until you publish it.
                </div>
              )}
              {field('learning_objectives', 'Learning Objectives')}
              {field('key_concepts', 'Key Concepts', 4)}
              {field('formulas', 'Formulas')}
              {field('definitions', 'Definitions', 3)}
              {field('worked_examples', 'Worked Examples', 5)}
              {field('exam_tips', 'Exam Tips')}
              {field('common_mistakes', 'Common Mistakes')}

              <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
                <button onClick={() => saveContent(true)} disabled={saving}
                  style={{ padding: '10px 18px', borderRadius: 'var(--r-lg)', border: 'none', background: 'var(--success)', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>
                  {saving ? 'Saving…' : 'Publish'}
                </button>
                <button onClick={() => saveContent(false)} disabled={saving}
                  style={{ padding: '10px 18px', borderRadius: 'var(--r-lg)', border: '1.5px solid var(--border-md)', background: 'var(--bg-raised)', color: 'var(--text-primary)', fontWeight: 700, cursor: 'pointer' }}>
                  Save Draft
                </button>
                <button onClick={generateContent} disabled={generating || content.status === 'published'}
                  style={{ padding: '10px 18px', borderRadius: 'var(--r-lg)', border: '1.5px solid var(--border-md)', background: 'var(--bg-raised)', color: 'var(--text-secondary)', fontWeight: 700, cursor: content.status === 'published' ? 'not-allowed' : 'pointer' }}
                  title={content.status === 'published' ? 'Already published — edit fields directly above instead' : ''}>
                  {generating ? 'Regenerating…' : '↻ Regenerate Draft'}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
