import React, { useState, useEffect, useRef } from 'react';
import toast from 'react-hot-toast';
import { textbookAPI, syllabusAPI } from '../../utils/api';

const cardS = { background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-xl)', padding: '18px' };
const inputS = { width: '100%', padding: '8px 10px', borderRadius: 'var(--r)', border: '1.5px solid var(--border-md)', background: 'var(--bg-raised)', color: 'var(--text-primary)', fontFamily: 'var(--font-body)', fontSize: 13 };
const labelS = { fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4, display: 'block' };

export default function TextbookLibraryPage() {
  const fileRef = useRef(null);
  const [textbooks, setTextbooks] = useState([]);
  const [examBodies, setExamBodies] = useState([]);
  const [selectedBook, setSelectedBook] = useState(null); // { textbook, chapters }
  const [uploading, setUploading] = useState(false);
  const [meta, setMeta] = useState({ title: '', author: '', description: '', exam_body_id: '' });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([textbookAPI.list(), syllabusAPI.examBodies()])
      .then(([tRes, bRes]) => { setTextbooks(tRes.data.textbooks || []); setExamBodies(bRes.data.exam_bodies || []); })
      .catch(() => toast.error('Could not load textbooks'))
      .finally(() => setLoading(false));
  }, []);

  const reload = () => textbookAPI.list().then(r => setTextbooks(r.data.textbooks || []));

  const handleUpload = async (file) => {
    if (!file) return;
    if (!meta.title.trim()) { toast.error('Add a title before choosing a file'); return; }
    setUploading(true);
    try {
      await textbookAPI.upload(file, meta);
      toast.success('Textbook uploaded — text extraction runs in the background for PDF/DOCX');
      setMeta({ title: '', author: '', description: '', exam_body_id: '' });
      reload();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Upload failed');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const openBook = async (id) => {
    try {
      const res = await textbookAPI.get(id);
      setSelectedBook(res.data);
    } catch { toast.error('Could not load textbook detail'); }
  };

  const deleteBook = async (id) => {
    if (!window.confirm('Delete this textbook and all its chapter mappings?')) return;
    try { await textbookAPI.delete(id); toast.success('Deleted'); setSelectedBook(null); reload(); }
    catch { toast.error('Delete failed'); }
  };

  const addChapter = async () => {
    const title = window.prompt('Chapter title:'); if (!title) return;
    const startPage = window.prompt('Start page (optional):');
    try {
      await textbookAPI.addChapter(selectedBook.textbook.id, { title, start_page: startPage ? Number(startPage) : null });
      toast.success('Chapter added');
      openBook(selectedBook.textbook.id);
    } catch { toast.error('Failed to add chapter'); }
  };

  const deleteChapter = async (chapterId) => {
    if (!window.confirm('Delete this chapter?')) return;
    try { await textbookAPI.deleteChapter(chapterId); openBook(selectedBook.textbook.id); }
    catch { toast.error('Failed'); }
  };

  if (loading) return <p style={{ padding: 20, color: 'var(--text-muted)' }}>Loading…</p>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <h1 style={{ fontSize: '1.5rem', marginBottom: 4 }}>📖 Textbook Library</h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          Upload learning materials, then map chapters to topics so students get a direct "Recommended Reading" link instead of the whole book.
        </p>
      </div>

      {/* Upload */}
      <div style={cardS}>
        <label style={labelS}>Upload New Textbook</label>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 12 }}>
          <input style={inputS} placeholder="Title *" value={meta.title} onChange={e => setMeta(m => ({ ...m, title: e.target.value }))} />
          <input style={inputS} placeholder="Author" value={meta.author} onChange={e => setMeta(m => ({ ...m, author: e.target.value }))} />
          <select style={inputS} value={meta.exam_body_id} onChange={e => setMeta(m => ({ ...m, exam_body_id: e.target.value }))}>
            <option value="">Exam body (optional)</option>
            {examBodies.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          <input style={inputS} placeholder="Description (optional)" value={meta.description} onChange={e => setMeta(m => ({ ...m, description: e.target.value }))} />
        </div>
        <input ref={fileRef} type="file" accept=".pdf,.docx,.pptx,.ppt,.txt,.jpg,.jpeg,.png,.webp" disabled={uploading}
          onChange={e => handleUpload(e.target.files[0])} style={{ display: 'none' }} />
        <button onClick={() => fileRef.current?.click()} disabled={uploading}
          style={{ padding: '10px 18px', borderRadius: 'var(--r-lg)', border: 'none', background: uploading ? 'var(--bg-raised)' : 'var(--brand-light)', color: uploading ? 'var(--text-muted)' : '#fff', fontWeight: 700, cursor: uploading ? 'not-allowed' : 'pointer' }}>
          {uploading ? 'Uploading…' : 'Choose File & Upload'}
        </button>
        <span style={{ marginLeft: 10, fontSize: 12, color: 'var(--text-muted)' }}>PDF, DOCX, PPTX, TXT, or images — up to 100MB</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: selectedBook ? '1fr 1.3fr' : '1fr', gap: 16 }}>
        {/* List */}
        <div style={cardS}>
          <label style={labelS}>Library ({textbooks.length})</label>
          {textbooks.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>No textbooks uploaded yet.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {textbooks.map(t => (
                <div key={t.id} onClick={() => openBook(t.id)}
                  style={{ padding: 10, borderRadius: 'var(--r)', background: selectedBook?.textbook?.id === t.id ? 'color-mix(in srgb, var(--brand-light) 12%, transparent)' : 'var(--bg-raised)', cursor: 'pointer' }}>
                  <p style={{ fontWeight: 700, fontSize: 13 }}>{t.title}</p>
                  <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                    {t.file_type.toUpperCase()} · {t.chapter_count} chapter{t.chapter_count !== 1 ? 's' : ''}
                    {t.extraction_status === 'pending' && ' · extracting text…'}
                    {t.extraction_status === 'failed' && ' · text extraction failed (file still readable)'}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Detail: chapters + topic mapping */}
        {selectedBook && (
          <div style={cardS}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
              <div>
                <h2 style={{ fontSize: '1.1rem' }}>{selectedBook.textbook.title}</h2>
                {selectedBook.textbook.author && <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>{selectedBook.textbook.author}</p>}
              </div>
              <button onClick={() => deleteBook(selectedBook.textbook.id)} style={{ background: 'none', border: 'none', color: 'var(--danger)', fontSize: 12, cursor: 'pointer' }}>Delete Textbook</button>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <label style={{ ...labelS, marginBottom: 0 }}>Chapters</label>
              <button onClick={addChapter} style={{ background: 'none', border: 'none', color: 'var(--brand-light)', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>+ Add Chapter</button>
            </div>

            {selectedBook.chapters.length === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>No chapters yet — add one, then map it to topics below.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {selectedBook.chapters.map(c => (
                  <ChapterRow key={c.id} chapter={c} onDelete={() => deleteChapter(c.id)} onLinked={() => openBook(selectedBook.textbook.id)} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ChapterRow({ chapter, onDelete, onLinked }) {
  const [subjectPicker, setSubjectPicker] = useState(false);
  const [examBodies, setExamBodies] = useState([]);
  const [examinations, setExaminations] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [topics, setTopics] = useState([]);
  const [selectedBody, setSelectedBody] = useState('');
  const [selectedExam, setSelectedExam] = useState('');
  const [selectedSubject, setSelectedSubject] = useState('');
  const [checkedTopics, setCheckedTopics] = useState(new Set(chapter.linked_topic_ids || []));
  const [saving, setSaving] = useState(false);

  const openPicker = () => {
    setSubjectPicker(true);
    if (examBodies.length === 0) syllabusAPI.examBodies().then(r => setExamBodies(r.data.exam_bodies || []));
  };

  useEffect(() => { if (selectedBody) syllabusAPI.examinations(selectedBody).then(r => setExaminations(r.data.examinations || [])); }, [selectedBody]);
  useEffect(() => { if (selectedExam) syllabusAPI.subjects(selectedExam).then(r => setSubjects(r.data.subjects || [])); }, [selectedExam]);
  useEffect(() => { if (selectedSubject) syllabusAPI.topics(selectedSubject).then(r => setTopics(r.data.topics || [])); }, [selectedSubject]);

  const toggle = (topicId) => setCheckedTopics(prev => {
    const next = new Set(prev);
    next.has(topicId) ? next.delete(topicId) : next.add(topicId);
    return next;
  });

  const save = async () => {
    setSaving(true);
    try {
      await textbookAPI.setChapterTopics(chapter.id, [...checkedTopics]);
      toast.success('Topics linked');
      onLinked();
    } catch { toast.error('Failed to save topic links'); }
    finally { setSaving(false); }
  };

  return (
    <div style={{ padding: 10, background: 'var(--bg-raised)', borderRadius: 'var(--r)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <p style={{ fontWeight: 700, fontSize: 13 }}>{chapter.title}{chapter.start_page ? ` (p.${chapter.start_page})` : ''}</p>
          <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {chapter.linked_topic_ids?.length || 0} topic{chapter.linked_topic_ids?.length !== 1 ? 's' : ''} linked
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={openPicker} style={{ background: 'none', border: 'none', color: 'var(--brand-light)', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Map Topics</button>
          <button onClick={onDelete} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer' }}>✕</button>
        </div>
      </div>

      {subjectPicker && (
        <div style={{ marginTop: 10, padding: 10, background: 'var(--bg-surface)', borderRadius: 'var(--r)', border: '1px solid var(--border)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 10 }}>
            <select style={inputS} value={selectedBody} onChange={e => setSelectedBody(e.target.value)}>
              <option value="">Exam body…</option>
              {examBodies.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <select style={inputS} value={selectedExam} onChange={e => setSelectedExam(e.target.value)} disabled={!selectedBody}>
              <option value="">Examination…</option>
              {examinations.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
            <select style={inputS} value={selectedSubject} onChange={e => setSelectedSubject(e.target.value)} disabled={!selectedExam}>
              <option value="">Subject…</option>
              {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          {topics.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
              {topics.map(t => (
                <label key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 8px', background: checkedTopics.has(t.id) ? 'color-mix(in srgb, var(--brand-light) 15%, transparent)' : 'var(--bg-raised)', borderRadius: 'var(--r-full)', fontSize: 12, cursor: 'pointer' }}>
                  <input type="checkbox" checked={checkedTopics.has(t.id)} onChange={() => toggle(t.id)} />
                  {t.name}
                </label>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={save} disabled={saving} style={{ padding: '6px 14px', borderRadius: 'var(--r-lg)', border: 'none', background: 'var(--success)', color: '#fff', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
              {saving ? 'Saving…' : 'Save Links'}
            </button>
            <button onClick={() => setSubjectPicker(false)} style={{ padding: '6px 14px', borderRadius: 'var(--r-lg)', border: '1px solid var(--border)', background: 'none', color: 'var(--text-secondary)', fontSize: 12, cursor: 'pointer' }}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}
