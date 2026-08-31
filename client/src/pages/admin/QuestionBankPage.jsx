import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { questionAPI } from '../../utils/api';
import Button from '../../components/shared/Button';
import MathText from '../../components/MathText';
import styles from './QuestionBankPage.module.css';

const DIFF_COLORS = { easy: 'tag-green', medium: 'tag-amber', hard: 'tag-red' };
const TYPE_LABELS = { mcq:'MCQ', multi_answer:'Multi', essay:'Essay', true_false:'T/F', fill_blank:'Fill', coding:'Code', drag_drop:'Drag' };

// Re-uploads the original source-paper photos for one exam_body + year (+
// optional subject) and patches media_url on the matching live questions.
// "Force" mode also re-crops diagrams that already have an image on disk —
// that's what fixes a diagram that imported fine but came out clipped/too
// tight (the normal, non-force run only fills in ones that are missing).
function RepairDiagramsModal({ subjects, onClose, onDone }) {
  const [examBody, setExamBody] = useState('WAEC');
  const [year, setYear] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [force, setForce] = useState(true);
  const [zip, setZip] = useState(null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);

  const run = async () => {
    if (!zip) return toast.error('Choose a .zip of the original source-paper photos first');
    if (!year.trim()) return toast.error('Year is required');
    setRunning(true);
    setResult(null);
    try {
      const res = await questionAPI.repairDiagrams({ zip, examBody, year: year.trim(), subjectId: subjectId || undefined, force });
      setResult(res.data);
      toast.success(res.data.message || 'Done');
      onDone();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Repair failed');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && !running && onClose()}>
      <div className="modal" style={{ maxWidth: 460 }}>
        <div className="modal-header">
          <h3>Fix / Re-crop Diagrams</h3>
          <button onClick={() => !running && onClose()} style={{ background:'var(--bg-raised)', border:'1px solid var(--border)', borderRadius:'var(--r)', width:30, height:30, cursor:'pointer' }}>✕</button>
        </div>
        <div className="modal-body">
          <p style={{ fontSize:13, color:'var(--text-secondary)', marginBottom:14, lineHeight:1.5 }}>
            Upload the same zip of original page photos you imported from. Matching is by question number (or text) within this exam body + year.
          </p>
          <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
            <div>
              <label style={{ fontSize:12, fontWeight:600, display:'block', marginBottom:4 }}>Exam Body</label>
              <input value={examBody} onChange={e => setExamBody(e.target.value)} placeholder="WAEC" style={{ width:'100%', padding:'8px 10px', borderRadius:8, border:'1px solid var(--border)' }} />
            </div>
            <div>
              <label style={{ fontSize:12, fontWeight:600, display:'block', marginBottom:4 }}>Year</label>
              <input value={year} onChange={e => setYear(e.target.value)} placeholder="1988" style={{ width:'100%', padding:'8px 10px', borderRadius:8, border:'1px solid var(--border)' }} />
            </div>
            <div>
              <label style={{ fontSize:12, fontWeight:600, display:'block', marginBottom:4 }}>Subject (optional)</label>
              <select value={subjectId} onChange={e => setSubjectId(e.target.value)} style={{ width:'100%', padding:'8px 10px', borderRadius:8, border:'1px solid var(--border)' }}>
                <option value="">All subjects</option>
                {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize:12, fontWeight:600, display:'block', marginBottom:4 }}>Source photos (.zip)</label>
              <input type="file" accept=".zip" onChange={e => setZip(e.target.files[0])} />
            </div>
            <label style={{ display:'flex', alignItems:'center', gap:8, fontSize:13, cursor:'pointer' }}>
              <input type="checkbox" checked={force} onChange={e => setForce(e.target.checked)} />
              Re-crop even diagrams that already have an image (fixes clipped/too-tight crops, not just missing ones)
            </label>
            {result && (
              <div style={{ fontSize:12, background:'var(--bg-raised)', border:'1px solid var(--border)', borderRadius:8, padding:'10px 12px', lineHeight:1.7 }}>
                Re-cropped: <b>{result.repaired}</b> · Already fine: <b>{result.already_fine}</b> · No diagram needed: <b>{result.no_diagram_needed}</b> · No match: <b>{result.no_match}</b> · Pages failed: <b>{result.pages_failed}</b>
              </div>
            )}
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose} disabled={running}>Close</button>
          <button className="btn btn-primary" onClick={run} disabled={running}>
            {running ? <><span className="spinner"/>Processing…</> : 'Run'}
          </button>
        </div>
      </div>
    </div>
  );
}

// Lists live, published questions whose options are all bare-letter
// placeholders ("A"/"B"/"C"/"D" — see hasRealOptionContent in
// utils/answerQuality.js). These are questions that made it into the live
// bank before the publish-time guard existed (or from any other path), and
// are otherwise invisible to admins until a student happens to hit one.
// Deactivating here uses the same is_active flag as the row's own Delete
// action elsewhere in this page, so it's reversible from the Question
// Builder if a question turns out to be fixable rather than junk.
function FlaggedOptionsModal({ onClose, onDone, navigate }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [items, setItems] = useState([]);
  const [working, setWorking] = useState(null); // id currently being deactivated

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await questionAPI.flaggedBadOptions();
      setItems(res.data.questions || []);
    } catch (err) {
      setError(err.response?.data?.error || "Couldn't load flagged questions");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const deactivate = async (q) => {
    setWorking(q.id);
    try {
      await questionAPI.delete(q.id); // soft delete (is_active=FALSE) — see routes/questions.js DELETE /:id
      toast.success('Deactivated — no longer shown to students');
      setItems(list => list.filter(x => x.id !== q.id));
      onDone();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to deactivate');
    } finally {
      setWorking(null);
    }
  };

  return (
    <div className="modal-backdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ maxWidth: 620, maxHeight:'80vh', display:'flex', flexDirection:'column' }}>
        <div className="modal-header">
          <h3>🚩 Flagged: Placeholder Options{!loading && !error ? ` (${items.length})` : ''}</h3>
          <button onClick={onClose} style={{ background:'var(--bg-raised)', border:'1px solid var(--border)', borderRadius:'var(--r)', width:30, height:30, cursor:'pointer' }}>✕</button>
        </div>
        <div className="modal-body" style={{ overflowY:'auto' }}>
          <p style={{ fontSize:13, color:'var(--text-secondary)', marginBottom:14, lineHeight:1.5 }}>
            These live questions have answer options that are just the bare letters "A"/"B"/"C"/"D" — never real content, usually a diagram-based option the import pipeline couldn't transcribe. Fix them in the Question Builder, or deactivate them so students stop seeing them.
          </p>
          {loading && <div style={{ fontSize:13, color:'var(--text-secondary)', padding:'16px 0' }}>Loading…</div>}
          {error && <div style={{ fontSize:13, color:'var(--danger, #DC2626)', padding:'16px 0' }}>{error}</div>}
          {!loading && !error && items.length === 0 && (
            <div style={{ fontSize:13, color:'var(--text-secondary)', padding:'16px 0' }}>None found — the live question bank is clean.</div>
          )}
          {!loading && !error && items.length > 0 && (
            <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
              {items.map(q => (
                <div key={q.id} style={{ border:'1px solid var(--border)', borderRadius:10, padding:'10px 12px' }}>
                  <div style={{ fontSize:12, color:'var(--text-secondary)', marginBottom:4 }}>
                    {q.subject_name || 'Unknown subject'} · {q.exam_body || '—'} {(() => { try { const tags = Array.isArray(q.tags)?q.tags:JSON.parse(q.tags||'[]'); const y = tags.find(t=>/^(19|20)\d{2}$/.test(String(t))); return y ? `· ${y}` : ''; } catch { return ''; } })()}
                  </div>
                  <div style={{ fontSize:13.5, color:'var(--text-primary)', marginBottom:8, lineHeight:1.5 }}>
                    <MathText text={q.question_text} inline />
                  </div>
                  <div style={{ display:'flex', gap:8 }}>
                    <button className="btn btn-secondary" style={{ fontSize:12, padding:'5px 10px' }} onClick={() => { onClose(); navigate(`/admin/questions/${q.id}/edit`); }}>Edit</button>
                    <button className="btn btn-danger" style={{ fontSize:12, padding:'5px 10px' }} disabled={working===q.id} onClick={() => deactivate(q)}>
                      {working===q.id ? 'Deactivating…' : 'Deactivate'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

export default function QuestionBankPage() {
  const navigate = useNavigate();
  const [questions, setQuestions] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(new Set());

  const [filters, setFilters] = useState({
    search: '', subject_id: '', difficulty: '', type: '', page: 1,
  });

  useEffect(() => {
    questionAPI.subjects().then(r => setSubjects(r.data.subjects || []));
  }, []);

  useEffect(() => {
    load();
  }, [filters]);

  const load = async () => {
    setLoading(true);
    try {
      const res = await questionAPI.list({ ...filters, limit: 25 });
      setQuestions(res.data.questions || []);
      setTotal(res.data.total || 0);
    } catch { toast.error('Failed to load questions'); }
    finally { setLoading(false); }
  };

  const setFilter = (key, val) => setFilters(f => ({ ...f, [key]: val, page: 1 }));

  const toggleSelect = (id) => {
    setSelected(s => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  const handleDelete = async (id) => {
    if (!confirm('Deactivate this question?')) return;
    try {
      await questionAPI.delete(id);
      toast.success('Question deactivated');
      load();
    } catch { toast.error('Delete failed'); }
  };

  const handleBulkDelete = async () => {
    if (!confirm(`Deactivate ${selected.size} questions?`)) return;
    let ok = 0;
    for (const id of selected) {
      try { await questionAPI.delete(id); ok++; } catch {}
    }
    toast.success(`Deactivated ${ok} questions`);
    setSelected(new Set());
    load();
  };

  // Explanations are generated once and stored on the question row (see
  // routes/questions.js) — but for a long time that only happened lazily,
  // the first time some student happened to open a question. Anything never
  // opened just sat there with no explanation, however simple it was. This
  // runs the batch backfill endpoint on a loop until every question in the
  // bank that's missing one has it, or the AI provider's daily quota runs
  // out (in which case it stops cleanly and can just be run again later —
  // it always picks up wherever it left off, nothing is lost or repeated).
  const [backfilling, setBackfilling] = useState(false);
  const [backfillProgress, setBackfillProgress] = useState(null); // { generated, remaining }

  // Same loop-until-done pattern as runBackfill below, but for questions
  // that made it all the way to publish with an empty correct_answers —
  // the thing that makes every option show as "wrong" no matter which one a
  // student picks (nothing can ever match an empty answer list), and makes
  // Generate Missing Explanations correctly refuse them too (there's
  // nothing recorded to explain the reasoning to). Deliberately meant to be
  // run BEFORE Generate Missing Explanations — solving an answer here also
  // saves a full explanation in the same AI call, so anything fixed by this
  // won't need a second call from that one right after.
  const [answerFixing, setAnswerFixing] = useState(false);
  const [answerFixProgress, setAnswerFixProgress] = useState(null); // { fixed, remaining }

  const runAnswerFix = async () => {
    setAnswerFixing(true);
    let totalFixed = 0;
    try {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const res = await questionAPI.backfillCorrectAnswers({ limit: 15 });
        const { fixed, remaining, quota_exceeded, retry_delay_seconds } = res.data;
        totalFixed += fixed;
        setAnswerFixProgress({ fixed: totalFixed, remaining });

        if (quota_exceeded) {
          toast(
            `Fixed ${totalFixed} question(s). AI quota reached — ${remaining} still need a recorded answer; run this again ${retry_delay_seconds ? `in about ${retry_delay_seconds}s` : 'later'}.`,
            { icon: '⏳', duration: 8000 }
          );
          break;
        }
        if (remaining === 0) {
          toast.success(`Done — every question now has a recorded correct answer (${totalFixed} fixed this run).`);
          break;
        }
        if (fixed === 0) {
          // Nothing fixed and not quota-exceeded — every remaining question
          // in this set is genuinely unsolvable from text alone (ambiguous,
          // needs a diagram, or the AI's own working never matched any of
          // the given options). Stop rather than looping on the same set
          // forever; these need a human to fix manually in Question Bank.
          toast(`Stopped — ${remaining} question(s) couldn't be solved automatically (likely need a diagram, or are ambiguous). Fix those manually in Question Bank.`, { icon: '⚠️', duration: 8000 });
          break;
        }
      }
    } catch (err) {
      toast.error(err.response?.data?.error || 'Answer fix failed');
    } finally {
      setAnswerFixing(false);
      load();
    }
  };

  const [showRepair, setShowRepair] = useState(false);
  const [showFlagged, setShowFlagged] = useState(false);
  const [rechecking, setRechecking] = useState(false);

  const runRecheckDiagrams = async () => {
    setRechecking(true);
    try {
      const res = await questionAPI.recheckDiagrams();
      toast.success(res.data.message || 'Queued for recheck');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Recheck failed');
    } finally {
      setRechecking(false);
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Question Bank</h1>
          <p className={styles.sub}>{total.toLocaleString()} questions available</p>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          {selected.size > 0 && (
            <Button variant="danger" size="sm" onClick={handleBulkDelete}>
              Delete {selected.size} selected
            </Button>
          )}
          <Button variant="ghost" onClick={runAnswerFix} disabled={answerFixing}>
            {answerFixing
              ? `⏳ Fixing… ${answerFixProgress ? `(${answerFixProgress.fixed} done, ${answerFixProgress.remaining} left)` : ''}`
              : '🔧 Fix Missing Correct Answers'}
          </Button>
          <Button variant="ghost" onClick={runBackfill} disabled={backfilling}>
            {backfilling
              ? `⏳ Generating… ${backfillProgress ? `(${backfillProgress.generated} done, ${backfillProgress.remaining} left)` : ''}`
              : '💡 Generate Missing Explanations'}
          </Button>
          <Button variant="ghost" onClick={() => setShowRepair(true)}>
            🖼️ Fix / Re-crop Diagrams
          </Button>
          <Button variant="ghost" onClick={runRecheckDiagrams} disabled={rechecking} title="Gives every already-checked diagram a fresh automatic look — use this if some got stuck 'checked' due to a temporary AI outage">
            {rechecking ? '⏳ Queuing…' : '🔄 Recheck All Diagrams'}
          </Button>
          <Button variant="ghost" onClick={() => setShowFlagged(true)}>
            🚩 Flagged Options
          </Button>
          <Button variant="ghost" onClick={() => navigate('/admin/questions/new')}>
            ✦ AI Generate
          </Button>
          <Button onClick={() => navigate('/admin/questions/new')}>+ New Question</Button>
        </div>
      </div>

      {showRepair && (
        <RepairDiagramsModal subjects={subjects} onClose={() => setShowRepair(false)} onDone={load} />
      )}
      {showFlagged && (
        <FlaggedOptionsModal onClose={() => setShowFlagged(false)} onDone={load} navigate={navigate} />
      )}

      {/* Filters */}
      <div className={styles.filterBar}>
        <input
          placeholder="Search questions..."
          value={filters.search}
          onChange={e => setFilter('search', e.target.value)}
          className={styles.searchInput}
        />
        <select value={filters.subject_id} onChange={e => setFilter('subject_id', e.target.value)} className={styles.filterSelect}>
          <option value="">All Subjects</option>
          {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select value={filters.difficulty} onChange={e => setFilter('difficulty', e.target.value)} className={styles.filterSelect}>
          <option value="">All Difficulty</option>
          <option value="easy">Easy</option>
          <option value="medium">Medium</option>
          <option value="hard">Hard</option>
        </select>
        <select value={filters.type} onChange={e => setFilter('type', e.target.value)} className={styles.filterSelect}>
          <option value="">All Types</option>
          <option value="mcq">MCQ</option>
          <option value="essay">Essay</option>
          <option value="true_false">True/False</option>
          <option value="coding">Coding</option>
        </select>
        {(filters.search || filters.subject_id || filters.difficulty || filters.type) && (
          <Button size="sm" variant="ghost" onClick={() => setFilters({ search:'', subject_id:'', difficulty:'', type:'', page:1 })}>
            Clear
          </Button>
        )}
        <div className={styles.filterRight}>
          Showing {questions.length} of {total}
        </div>
      </div>

      {/* Question list */}
      {loading ? (
        <div style={{ display:'flex', justifyContent:'center', padding:60 }}><div className="spinner" style={{width:28,height:28}} /></div>
      ) : (
        <div className={styles.list}>
          {questions.length === 0 && (
            <div style={{ padding:60, textAlign:'center', color:'var(--text-muted)' }}>
              No questions found.{' '}
              <span onClick={() => navigate('/admin/questions/new')} style={{ color:'var(--accent)', cursor:'pointer' }}>
                Create one →
              </span>
            </div>
          )}
          {questions.map(q => {
            const opts = (() => { try { return JSON.parse(q.options||'[]'); } catch { return []; } })();
            const correct = (() => { try { return JSON.parse(q.correct_answers||'[]'); } catch { return []; } })();
            const tags = (() => { try { return JSON.parse(q.tags||'[]'); } catch { return []; } })();
            return (
              <div key={q.id} className={`${styles.qItem} ${selected.has(q.id) ? styles.qItemSelected : ''}`}>
                <input
                  type="checkbox"
                  checked={selected.has(q.id)}
                  onChange={() => toggleSelect(q.id)}
                  className={styles.qCheck}
                />
                <div className={styles.qContent}>
                  <div className={styles.qText}><MathText text={q.question_text} inline /></div>
                  {opts.length > 0 && (
                    <div className={styles.qOpts}>
                      {opts.slice(0,4).map((opt, i) => (
                        <span key={i} className={`${styles.qOpt} ${correct.includes(opt) ? styles.qOptCorrect : ''}`}>
                          {String.fromCharCode(65+i)}) <MathText text={opt} inline />
                        </span>
                      ))}
                    </div>
                  )}
                  <div className={styles.qMeta}>
                    <span className={`tag ${DIFF_COLORS[q.difficulty] || 'tag-gray'}`}>{q.difficulty}</span>
                    <span className="tag tag-gray">{TYPE_LABELS[q.question_type] || q.question_type}</span>
                    {q.subject_name && <span className="tag tag-blue">{q.subject_name}</span>}
                    <span style={{ fontSize:11, color:'var(--text-muted)' }}>{q.marks} mark{q.marks !== 1 ? 's' : ''}</span>
                    {tags.slice(0,3).map(t => <span key={t} className={styles.tag}>{t}</span>)}
                    {q.p_value != null && (
                      <span style={{ fontFamily:'var(--font-mono)', fontSize:10, color:'var(--text-muted)' }}>
                        P={parseFloat(q.p_value).toFixed(2)}
                      </span>
                    )}
                  </div>
                </div>
                <div className={styles.qActions}>
                  <Button size="xs" variant="ghost" onClick={() => navigate(`/admin/questions/${q.id}/edit`)}>Edit</Button>
                  <Button size="xs" variant="danger" onClick={() => handleDelete(q.id)}>Delete</Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {total > 25 && (
        <div className={styles.pagination}>
          <Button size="sm" variant="ghost" disabled={filters.page <= 1} onClick={() => setFilter('page', filters.page - 1)}>← Prev</Button>
          <span style={{ fontSize:13, color:'var(--text-secondary)' }}>
            Page {filters.page} of {Math.ceil(total / 25)}
          </span>
          <Button size="sm" variant="ghost" disabled={filters.page >= Math.ceil(total/25)} onClick={() => setFilter('page', filters.page + 1)}>Next →</Button>
        </div>
      )}
    </div>
  );
}
