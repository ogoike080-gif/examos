import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { importBatchAPI, syllabusAPI } from '../../utils/api';

const STATUS_META = {
  verified:        { label: 'Verified',        bg: 'var(--success-dim)', fg: 'var(--success)' },
  needs_review:    { label: 'Needs Review',     bg: 'var(--warning-dim)', fg: 'var(--warning)' },
  answer_conflict: { label: 'Answer Conflict',  bg: 'var(--danger-dim)',  fg: 'var(--danger)'  },
  duplicate:       { label: 'Duplicate',        bg: 'var(--bg-raised)',   fg: 'var(--text-muted)' },
  missing:         { label: 'Missing',          bg: 'var(--bg-raised)',   fg: 'var(--text-muted)' },
  rejected:        { label: 'Rejected',         bg: 'var(--bg-raised)',   fg: 'var(--text-muted)' },
};

const cardS = { background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-xl)', padding: '20px' };
const inputS = { width: '100%', padding: '8px 10px', borderRadius: 'var(--r)', border: '1.5px solid var(--border-md)', background: 'var(--bg-raised)', color: 'var(--text-primary)', fontFamily: 'var(--font-body)', fontSize: 13 };
const btnS = (active) => ({
  padding: '6px 14px', borderRadius: 'var(--r-lg)', border: `1.5px solid ${active ? 'var(--brand-light)' : 'var(--border)'}`,
  background: active ? 'color-mix(in srgb, var(--brand-light) 12%, transparent)' : 'var(--bg-raised)',
  color: active ? 'var(--brand-light)' : 'var(--text-secondary)', fontWeight: 700, fontSize: 12, cursor: 'pointer',
});

export default function ImportBatchReviewPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [batch, setBatch] = useState(null);
  const [staged, setStaged] = useState([]);
  const [pages, setPages] = useState([]);
  const [retryingPageId, setRetryingPageId] = useState(null);
  const [fillingNumber, setFillingNumber] = useState(null);
  const [fillDraft, setFillDraft] = useState({ question_text: '', options: '', correct_answer: '', explanation: '', question_type: 'mcq' });
  const [filling, setFilling] = useState(false);
  const [filter, setFilter] = useState(null); // null = all
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState({});
  const [publishing, setPublishing] = useState(false);

  useEffect(() => { load(); }, [id, filter]);

  const load = async () => {
    setLoading(true);
    try {
      const [batchRes, stagedRes, pagesRes] = await Promise.all([
        importBatchAPI.get(id),
        importBatchAPI.staged(id, filter),
        importBatchAPI.pages(id),
      ]);
      setBatch(batchRes.data.batch);
      setStaged(stagedRes.data.staged || []);
      setPages(pagesRes.data.pages || []);
    } catch {
      toast.error('Could not load this batch');
    } finally {
      setLoading(false);
    }
  };

  const retryPage = async (pageId) => {
    setRetryingPageId(pageId);
    try {
      const res = await importBatchAPI.retryPage(id, pageId);
      toast.success(res.data.message);
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Retry failed');
    } finally {
      setRetryingPageId(null);
    }
  };

  const startFillMissing = (number) => {
    setFillingNumber(number);
    setFillDraft({ question_text: '', options: '', correct_answer: '', explanation: '', question_type: 'mcq' });
  };

  const submitFillMissing = async () => {
    if (!fillDraft.question_text.trim()) { toast.error('Question text is required'); return; }
    setFilling(true);
    try {
      const options = fillDraft.options.split('\n').map(s => s.trim()).filter(Boolean);
      await importBatchAPI.fillMissing(id, fillingNumber, {
        question_text: fillDraft.question_text,
        options,
        correct_answer: fillDraft.correct_answer || null,
        explanation: fillDraft.explanation,
        question_type: fillDraft.question_type,
      });
      toast.success(`Question ${fillingNumber} added and verified`);
      setFillingNumber(null);
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not add question');
    } finally {
      setFilling(false);
    }
  };

  const parseArr = (v) => { try { return Array.isArray(v) ? v : JSON.parse(v || '[]'); } catch { return []; } };

  // Topic-picker state — reused cascading pattern from the textbook chapter mapper
  const [topicPickerRowId, setTopicPickerRowId] = useState(null);
  const [examBodies, setExamBodies] = useState([]);
  const [examinations, setExaminations] = useState([]);
  const [tSubjects, setTSubjects] = useState([]);
  const [tTopics, setTTopics] = useState([]);
  const [pickBody, setPickBody] = useState('');
  const [pickExam, setPickExam] = useState('');
  const [pickSubject, setPickSubject] = useState('');
  const [solvingMissing, setSolvingMissing] = useState(false);

  const openTopicPicker = (rowId) => {
    setTopicPickerRowId(rowId);
    if (examBodies.length === 0) syllabusAPI.examBodies().then(r => setExamBodies(r.data.exam_bodies || []));
  };
  useEffect(() => { if (pickBody) syllabusAPI.examinations(pickBody).then(r => setExaminations(r.data.examinations || [])); }, [pickBody]);
  useEffect(() => { if (pickExam) syllabusAPI.subjects(pickExam).then(r => setTSubjects(r.data.subjects || [])); }, [pickExam]);
  useEffect(() => { if (pickSubject) syllabusAPI.topics(pickSubject).then(r => setTTopics(r.data.topics || [])); }, [pickSubject]);

  const assignTopic = async (rowId, topicId, topicName) => {
    try {
      await importBatchAPI.updateStaged(id, rowId, { topic_id: topicId });
      toast.success(`Tagged to topic: ${topicName}`);
      setTopicPickerRowId(null);
      load();
    } catch { toast.error('Could not assign topic'); }
  };

  const solveMissingAnswers = async () => {
    setSolvingMissing(true);
    try {
      const res = await importBatchAPI.aiSolveMissing(id);
      toast.success(res.data.message);
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'AI-solve failed');
    } finally {
      setSolvingMissing(false);
    }
  };

  const startEdit = (row) => {
    setEditingId(row.id);
    setDraft({
      question_text: row.question_text,
      options: parseArr(row.options).join('\n'),
      correct_answers: parseArr(row.correct_answers)[0] || '',
      explanation: row.explanation || '',
      question_number: row.question_number ?? '',
    });
  };

  const saveEdit = async (rowId, markVerified) => {
    try {
      const options = draft.options.split('\n').map(s => s.trim()).filter(Boolean);
      await importBatchAPI.updateStaged(id, rowId, {
        question_text: draft.question_text,
        options,
        correct_answers: draft.correct_answers ? [draft.correct_answers] : [],
        explanation: draft.explanation,
        question_number: draft.question_number === '' ? null : Number(draft.question_number),
        review_status: markVerified ? 'verified' : 'needs_review',
      });
      toast.success(markVerified ? 'Marked verified' : 'Changes saved');
      setEditingId(null);
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Save failed');
    }
  };

  const quickVerify = async (rowId) => {
    try {
      await importBatchAPI.updateStaged(id, rowId, { review_status: 'verified' });
      toast.success('Marked verified');
      load();
    } catch { toast.error('Could not update status'); }
  };

  const reject = async (rowId) => {
    try {
      await importBatchAPI.updateStaged(id, rowId, { review_status: 'rejected' });
      load();
    } catch { toast.error('Could not update status'); }
  };

  const resolveConflict = async (rowId, chosenAnswer) => {
    try {
      await importBatchAPI.updateStaged(id, rowId, { correct_answers: [chosenAnswer], review_status: 'verified' });
      toast.success('Conflict resolved');
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not resolve conflict');
    }
  };

  const publish = async () => {
    setPublishing(true);
    try {
      const res = await importBatchAPI.publish(id);
      toast.success(res.data.message);
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Publish failed');
    } finally {
      setPublishing(false);
    }
  };

  if (loading && !batch) return <p style={{ color: 'var(--text-muted)' }}>Loading…</p>;
  if (!batch) return <p style={{ color: 'var(--danger)' }}>Batch not found.</p>;

  const counts = {
    all: batch.extracted_count,
    verified: batch.verified_count,
    needs_review: batch.needs_review_count,
    answer_conflict: batch.answer_conflict_count,
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <button onClick={() => navigate('/admin/import/batches')} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 13, cursor: 'pointer', marginBottom: 8 }}>← All batches</button>
          <h1 style={{ fontSize: '1.5rem', marginBottom: 4 }}>{batch.exam_body} {batch.year} — {batch.subject_name || 'Unknown subject'}</h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            {batch.paper_type} · Import Quality: <strong style={{ color: 'var(--text-primary)' }}>{batch.quality_score != null ? `${batch.quality_score}%` : '—'}</strong>
            {' · '}Status: <strong style={{ color: 'var(--text-primary)' }}>{batch.status}</strong>
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={solveMissingAnswers}
            disabled={solvingMissing}
            title="Attempts to compute an answer for questions where no answer key was found — flagged as AI-derived, stays needs_review until you confirm"
            style={{
              padding: '10px 16px', borderRadius: 'var(--r-lg)', border: '1.5px solid var(--border-md)',
              background: solvingMissing ? 'var(--bg-raised)' : 'var(--bg-surface)', color: 'var(--text-secondary)',
              fontWeight: 700, fontSize: 14, cursor: solvingMissing ? 'not-allowed' : 'pointer',
            }}
          >
            {solvingMissing ? 'Solving…' : '✨ AI-Solve Missing Answers'}
          </button>
          <button
            onClick={publish}
            disabled={publishing || batch.status === 'published' || counts.verified === 0}
            style={{
              padding: '10px 20px', borderRadius: 'var(--r-lg)', border: 'none', fontWeight: 700, fontSize: 14,
              background: publishing || counts.verified === 0 ? 'var(--bg-raised)' : 'var(--success)',
              color: publishing || counts.verified === 0 ? 'var(--text-muted)' : '#fff',
              cursor: publishing || counts.verified === 0 ? 'not-allowed' : 'pointer',
            }}
          >
            {publishing ? 'Publishing…' : `Publish ${counts.verified} Verified Question${counts.verified !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>

      {batch.number_gaps && parseArr(batch.number_gaps).length > 0 && (
        <div style={{ ...cardS, borderColor: 'var(--warning)', background: 'var(--warning-dim)' }}>
          <p style={{ marginBottom: 10 }}>
            ⚠ Missing question numbers from the objective section — likely skipped during reading, check the source photos or type them in below:
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {parseArr(batch.number_gaps).map(n => (
              <button key={n} onClick={() => startFillMissing(n)}
                style={{ padding: '5px 12px', borderRadius: 'var(--r-lg)', border: '1.5px solid var(--warning)', background: 'var(--bg-raised)', color: 'var(--warning)', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
                + Add Q{n}
              </button>
            ))}
          </div>

          {fillingNumber !== null && (
            <div style={{ marginTop: 14, padding: 14, background: 'var(--bg-raised)', borderRadius: 'var(--r-lg)', border: '1px solid var(--border)' }}>
              <p style={{ fontWeight: 800, marginBottom: 10 }}>Manually add Question {fillingNumber}</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <select style={inputS} value={fillDraft.question_type}
                  onChange={e => setFillDraft(d => ({ ...d, question_type: e.target.value }))}>
                  <option value="mcq">Multiple Choice</option>
                  <option value="essay">Essay / Theory</option>
                </select>
                <textarea style={{ ...inputS, minHeight: 60 }} placeholder="Question text — type it exactly as printed on the paper"
                  value={fillDraft.question_text} onChange={e => setFillDraft(d => ({ ...d, question_text: e.target.value }))} />
                {fillDraft.question_type === 'mcq' && (
                  <>
                    <textarea style={{ ...inputS, minHeight: 80 }} placeholder="Options — one per line"
                      value={fillDraft.options} onChange={e => setFillDraft(d => ({ ...d, options: e.target.value }))} />
                    <input style={inputS} placeholder="Correct answer (must match an option exactly)"
                      value={fillDraft.correct_answer} onChange={e => setFillDraft(d => ({ ...d, correct_answer: e.target.value }))} />
                  </>
                )}
                <textarea style={{ ...inputS, minHeight: 40 }} placeholder="Explanation (optional)"
                  value={fillDraft.explanation} onChange={e => setFillDraft(d => ({ ...d, explanation: e.target.value }))} />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={submitFillMissing} disabled={filling}
                    style={{ ...btnS(true), color: 'var(--success)', borderColor: 'var(--success)' }}>
                    {filling ? 'Saving…' : 'Save & Verify'}
                  </button>
                  <button onClick={() => setFillingNumber(null)} style={btnS(false)}>Cancel</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Page-by-page status, with retry for anything that failed */}
      {pages.some(p => p.status === 'failed') && (
        <div style={cardS}>
          <label style={labelS}>Pages Needing Attention</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {pages.filter(p => p.status === 'failed').map(p => (
              <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: 'var(--bg-raised)', borderRadius: 'var(--r)' }}>
                <div>
                  <span style={{ fontWeight: 700, fontSize: 13 }}>{p.filename}</span>
                  <p style={{ fontSize: 12, color: 'var(--danger)', marginTop: 2 }}>{p.error_message}</p>
                  {p.retry_count > 0 && <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>Retried {p.retry_count}x</p>}
                </div>
                <button onClick={() => retryPage(p.id)} disabled={retryingPageId === p.id}
                  style={{ ...btnS(false), color: 'var(--brand-light)', borderColor: 'var(--brand-light)' }}>
                  {retryingPageId === p.id ? 'Retrying…' : 'Retry Page'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Status filter tabs */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button style={btnS(filter === null)} onClick={() => setFilter(null)}>All ({counts.all})</button>
        <button style={btnS(filter === 'verified')} onClick={() => setFilter('verified')}>Verified ({counts.verified})</button>
        <button style={btnS(filter === 'needs_review')} onClick={() => setFilter('needs_review')}>Needs Review ({counts.needs_review})</button>
        <button style={btnS(filter === 'answer_conflict')} onClick={() => setFilter('answer_conflict')}>Answer Conflicts ({counts.answer_conflict})</button>
      </div>

      {/* Staged questions */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {staged.length === 0 ? (
          <div style={cardS}><p style={{ color: 'var(--text-muted)', fontSize: 14 }}>Nothing in this filter.</p></div>
        ) : staged.map(row => {
          const meta = STATUS_META[row.review_status] || STATUS_META.needs_review;
          const isEditing = editingId === row.id;
          return (
            <div key={row.id} style={cardS}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <span style={{ fontWeight: 800, fontSize: 13 }}>
                    {row.question_number != null ? `Q${row.question_number}` : '(unnumbered)'}
                  </span>
                  <span style={{ padding: '2px 10px', borderRadius: 'var(--r-full)', background: meta.bg, color: meta.fg, fontWeight: 700, fontSize: 11 }}>{meta.label}</span>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Confidence: {row.confidence_score}%</span>
                  {row.source_page_url && (
                    <a href={row.source_page_url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: 'var(--brand-light)', textDecoration: 'none' }}>
                      View Source Page ↗
                    </a>
                  )}
                </div>
                {!isEditing && (
                  <div style={{ display: 'flex', gap: 8 }}>
                    {row.review_status !== 'verified' && (
                      <button onClick={() => quickVerify(row.id)} style={{ ...btnS(false), color: 'var(--success)' }}>Quick Verify</button>
                    )}
                    <button onClick={() => openTopicPicker(row.id)} style={{ ...btnS(false), color: row.topic_id ? 'var(--success)' : 'var(--text-secondary)' }}>
                      {row.topic_id ? '✓ Topic' : '+ Topic'}
                    </button>
                    <button onClick={() => startEdit(row)} style={btnS(false)}>Edit</button>
                    <button onClick={() => reject(row.id)} style={{ ...btnS(false), color: 'var(--danger)' }}>Reject</button>
                  </div>
                )}
              </div>

              {topicPickerRowId === row.id && (
                <div style={{ marginBottom: 10, padding: 12, background: 'var(--bg-raised)', borderRadius: 'var(--r)', border: '1px solid var(--border)' }}>
                  <p style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Tag this question to a syllabus topic (so it's usable for "Practice Questions" on that topic's page):</p>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 8 }}>
                    <select style={inputS} value={pickBody} onChange={e => { setPickBody(e.target.value); setPickExam(''); setPickSubject(''); }}>
                      <option value="">Exam body…</option>
                      {examBodies.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select>
                    <select style={inputS} value={pickExam} onChange={e => { setPickExam(e.target.value); setPickSubject(''); }} disabled={!pickBody}>
                      <option value="">Examination…</option>
                      {examinations.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                    </select>
                    <select style={inputS} value={pickSubject} onChange={e => setPickSubject(e.target.value)} disabled={!pickExam}>
                      <option value="">Subject…</option>
                      {tSubjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                    <select style={inputS} disabled={!pickSubject} onChange={e => {
                      const t = tTopics.find(t => t.id === e.target.value);
                      if (t) assignTopic(row.id, t.id, t.name);
                    }}>
                      <option value="">Topic…</option>
                      {tTopics.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {row.topic_id && <button onClick={() => assignTopic(row.id, null, 'none')} style={{ ...btnS(false), color: 'var(--danger)' }}>Remove Topic</button>}
                    <button onClick={() => setTopicPickerRowId(null)} style={btnS(false)}>Close</button>
                  </div>
                </div>
              )}

              {row.review_notes && !isEditing && (
                <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>Notes: {row.review_notes}</p>
              )}

              {/* Answer conflict resolution — shows exactly what each source said,
                  rather than just flagging that a disagreement exists. */}
              {row.review_status === 'answer_conflict' && !isEditing && parseArr(row.answer_candidates).length > 0 && (
                <div style={{ marginBottom: 10, padding: 12, background: 'var(--danger-dim)', borderRadius: 'var(--r)', border: '1px solid var(--danger)' }}>
                  <p style={{ fontSize: 12, fontWeight: 800, color: 'var(--danger)', marginBottom: 8 }}>
                    Sources disagree on the answer — pick the correct one:
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {parseArr(row.answer_candidates).map((c, i) => (
                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 10px', background: 'var(--bg-raised)', borderRadius: 'var(--r)' }}>
                        <span style={{ fontSize: 13 }}>
                          <strong>{c.answer}</strong>
                          <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>
                            {c.source === 'own_page' ? 'From the question\'s own page' : 'From an answer-key page'}
                            {c.source_photo ? ` (${c.source_photo})` : ''}
                          </span>
                        </span>
                        <button onClick={() => resolveConflict(row.id, c.answer)}
                          style={{ ...btnS(false), color: 'var(--success)', borderColor: 'var(--success)' }}>
                          Use This
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {isEditing ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 700 }}>Question Number</label>
                    <input style={{ ...inputS, maxWidth: 120 }} type="number" value={draft.question_number}
                      onChange={e => setDraft(d => ({ ...d, question_number: e.target.value }))} />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 700 }}>Question Text</label>
                    <textarea style={{ ...inputS, minHeight: 70 }} value={draft.question_text}
                      onChange={e => setDraft(d => ({ ...d, question_text: e.target.value }))} />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 700 }}>Options (one per line)</label>
                    <textarea style={{ ...inputS, minHeight: 90 }} value={draft.options}
                      onChange={e => setDraft(d => ({ ...d, options: e.target.value }))} />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 700 }}>Correct Answer (must match an option exactly)</label>
                    <input style={inputS} value={draft.correct_answers}
                      onChange={e => setDraft(d => ({ ...d, correct_answers: e.target.value }))} />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 700 }}>Explanation</label>
                    <textarea style={{ ...inputS, minHeight: 50 }} value={draft.explanation}
                      onChange={e => setDraft(d => ({ ...d, explanation: e.target.value }))} />
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                    <button onClick={() => saveEdit(row.id, true)} style={{ ...btnS(true), color: 'var(--success)', borderColor: 'var(--success)' }}>Save & Verify</button>
                    <button onClick={() => saveEdit(row.id, false)} style={btnS(false)}>Save (keep in review)</button>
                    <button onClick={() => setEditingId(null)} style={{ ...btnS(false), color: 'var(--danger)' }}>Cancel</button>
                  </div>
                </div>
              ) : (
                <>
                  <p style={{ fontSize: 14, marginBottom: 8 }}>{row.question_text}</p>
                  {parseArr(row.options).length > 0 && (
                    <ul style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 8, paddingLeft: 18 }}>
                      {parseArr(row.options).map((o, i) => (
                        <li key={i} style={{ color: parseArr(row.correct_answers).includes(o) ? 'var(--success)' : 'var(--text-secondary)', fontWeight: parseArr(row.correct_answers).includes(o) ? 700 : 400 }}>
                          {String.fromCharCode(65 + i)}. {o}
                        </li>
                      ))}
                    </ul>
                  )}
                  {row.media_url && (
                    <img src={row.media_url} alt="Diagram" style={{ maxWidth: 280, borderRadius: 'var(--r)', border: '1px solid var(--border)', marginBottom: 8 }} />
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
