import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { questionAPI } from '../../utils/api';
import Button from '../../components/shared/Button';
import MathText from '../../components/MathText';
import styles from './QuestionBankPage.module.css';

const DIFF_COLORS = { easy: 'tag-green', medium: 'tag-amber', hard: 'tag-red' };
const TYPE_LABELS = { mcq:'MCQ', multi_answer:'Multi', essay:'Essay', true_false:'T/F', fill_blank:'Fill', coding:'Code', drag_drop:'Drag' };

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
          <Button variant="ghost" onClick={() => navigate('/admin/questions/new')}>
            ✦ AI Generate
          </Button>
          <Button onClick={() => navigate('/admin/questions/new')}>+ New Question</Button>
        </div>
      </div>

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
