import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { importBatchAPI } from '../../utils/api';

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
  const [filter, setFilter] = useState(null); // null = all
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState({});
  const [publishing, setPublishing] = useState(false);

  useEffect(() => { load(); }, [id, filter]);

  const load = async () => {
    setLoading(true);
    try {
      const [batchRes, stagedRes] = await Promise.all([
        importBatchAPI.get(id),
        importBatchAPI.staged(id, filter),
      ]);
      setBatch(batchRes.data.batch);
      setStaged(stagedRes.data.staged || []);
    } catch {
      toast.error('Could not load this batch');
    } finally {
      setLoading(false);
    }
  };

  const parseArr = (v) => { try { return Array.isArray(v) ? v : JSON.parse(v || '[]'); } catch { return []; } };

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

      {batch.number_gaps && parseArr(batch.number_gaps).length > 0 && (
        <div style={{ ...cardS, borderColor: 'var(--warning)', background: 'var(--warning-dim)' }}>
          ⚠ Missing question numbers from the objective section: {parseArr(batch.number_gaps).slice(0, 20).join(', ')}
          {parseArr(batch.number_gaps).length > 20 ? '…' : ''} — likely skipped during reading, check the source photos.
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
                </div>
                {!isEditing && (
                  <div style={{ display: 'flex', gap: 8 }}>
                    {row.review_status !== 'verified' && (
                      <button onClick={() => quickVerify(row.id)} style={{ ...btnS(false), color: 'var(--success)' }}>Quick Verify</button>
                    )}
                    <button onClick={() => startEdit(row)} style={btnS(false)}>Edit</button>
                    <button onClick={() => reject(row.id)} style={{ ...btnS(false), color: 'var(--danger)' }}>Reject</button>
                  </div>
                )}
              </div>

              {row.review_notes && !isEditing && (
                <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>Notes: {row.review_notes}</p>
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
