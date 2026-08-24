import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { importBatchAPI, subjectAPI, diagramRepairAPI, syllabusAPI } from '../../utils/api';

// Was a fixed 7-item list — an admin wanting to import papers for a
// university's own entrance exam (or any exam body not already known to the
// app) had no way to add one; this page only ever showed what was hardcoded
// here. Exam bodies are now loaded from the same exam_bodies table the Exam
// Body Manager page already manages (see routes/syllabus.js) — add one
// there, or right from the dropdown below, and it shows up in both places
// immediately, no code change needed.
const FALLBACK_EXAM_BODIES = ['WAEC', 'JAMB', 'NECO', 'NABTEB', 'BECE', 'Post-UTME', 'General'];
const ADD_NEW_VALUE = '__add_new__';
const PAPER_TYPES = ['objective', 'theory', 'essay', 'practical', 'combined'];

const STATUS_COLORS = {
  processing: { bg: 'var(--warning-dim)', fg: 'var(--warning)' },
  staging:    { bg: 'var(--warning-dim)', fg: 'var(--warning)' },
  review:     { bg: 'var(--warning-dim)', fg: 'var(--warning)' },
  published:  { bg: 'var(--success-dim)', fg: 'var(--success)' },
  cancelled:  { bg: 'var(--danger-dim)',  fg: 'var(--danger)'  },
};

const labelS = { fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6, display: 'block' };
const cardS  = { background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-xl)', padding: '20px' };
const inputS = { width: '100%', padding: '10px 12px', borderRadius: 'var(--r)', border: '1.5px solid var(--border-md)', background: 'var(--bg-raised)', color: 'var(--text-primary)', fontFamily: 'var(--font-body)', fontSize: 14 };

export default function ImportBatchesPage() {
  const navigate = useNavigate();
  const fileRef = useRef(null);
  const repairFileRef = useRef(null);
  const [subjects, setSubjects] = useState([]);
  const [examBodies, setExamBodies] = useState([]);
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadStage, setUploadStage] = useState('');
  const [repairing, setRepairing] = useState(false);
  const [repairConfig, setRepairConfig] = useState({ exam_body: 'WAEC', year: '', subject_id: '' });
  const [config, setConfig] = useState({
    exam_body: 'WAEC', year: new Date().getFullYear(), subject_id: '',
    paper_type: 'objective', expected_count: '',
  });

  useEffect(() => {
    subjectAPI.list().then(r => setSubjects(r.data.subjects || [])).catch(() => {});
    loadExamBodies();
    loadBatches();
  }, []);

  const loadExamBodies = () => {
    syllabusAPI.examBodies()
      .then(r => {
        const bodies = r.data.exam_bodies || [];
        setExamBodies(bodies.length ? bodies : FALLBACK_EXAM_BODIES.map(code => ({ id: code, code, name: code })));
      })
      .catch(() => setExamBodies(FALLBACK_EXAM_BODIES.map(code => ({ id: code, code, name: code }))));
  };

  // Same simple prompt-based add ExamBodyManagerPage uses — asks for a full
  // name and a short code, creates it via the shared exam_bodies table, then
  // reloads the list and selects the new one in whichever dropdown triggered
  // this. A university (or any exam body not already in the list) becomes
  // available here — and in Exam Body Manager, and anywhere else that reads
  // the same table — immediately, no separate "sync" step.
  const addExamBodyInline = async (applyTo) => {
    const name = window.prompt('Exam body name (e.g. University of Lagos Post-UTME):');
    if (!name?.trim()) return;
    const code = window.prompt('Short code to use when selecting this (e.g. UNILAG):', name.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 15));
    if (!code?.trim()) return;
    try {
      await syllabusAPI.createExamBody({ name: name.trim(), code: code.trim() });
      toast.success(`"${name.trim()}" added`);
      loadExamBodies();
      applyTo(code.trim().toUpperCase());
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not add exam body');
    }
  };

  const loadBatches = () => {
    setLoading(true);
    importBatchAPI.list()
      .then(r => setBatches(r.data.batches || []))
      .catch(() => toast.error('Could not load import batches'))
      .finally(() => setLoading(false));
  };

  const set = (k, v) => setConfig(c => ({ ...c, [k]: v }));

  const handleUpload = async (file) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.zip')) {
      toast.error('This pipeline currently accepts .zip files of page photos only');
      return;
    }
    setUploading(true);
    setUploadStage('Reading pages and running the extraction pipeline — this can take a few minutes for a full booklet, especially with low-confidence pages needing a second AI pass…');
    try {
      const res = await importBatchAPI.uploadZip(file, config);
      const d = res.data;
      toast.success(
        `Batch created: ${d.extracted} questions extracted · ${d.verified} verified · ${d.needs_review} need review` +
        (d.answer_conflicts ? ` · ${d.answer_conflicts} answer conflicts` : '')
      );
      loadBatches();
      navigate(`/admin/import/batches/${d.batch_id}`);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Batch import failed');
    } finally {
      setUploading(false);
      setUploadStage('');
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handleRepair = async (file) => {
    if (!file) return;
    if (!repairConfig.exam_body || !repairConfig.year) {
      toast.error('Fill in Exam Body and Year first — needed to know which live questions to match against');
      return;
    }
    setRepairing(true);
    try {
      const res = await diagramRepairAPI.repair(file, repairConfig);
      const d = res.data;
      toast.success(
        `${d.message} · ${d.already_fine} already fine · ${d.no_match} unmatched` +
        (d.pages_failed ? ` · ${d.pages_failed} page(s) failed` : '')
      );
      if (d.unmatched_sample?.length) {
        console.log('Unmatched questions (first 10):', d.unmatched_sample);
      }
    } catch (err) {
      toast.error(err.response?.data?.error || 'Diagram repair failed');
    } finally {
      setRepairing(false);
      if (repairFileRef.current) repairFileRef.current.value = '';
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div>
        <h1 style={{ fontSize: '1.5rem', marginBottom: 4 }}>Import (Reviewed Pipeline)</h1>
        <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          Every upload here is staged and scored for confidence before anything reaches the live question bank —
          nothing publishes until you review it. For quick single-photo or CSV imports without staging, use the{' '}
          <a href="/admin/import" style={{ color: 'var(--brand-light)' }}>original Import page</a> instead.
        </p>
      </div>

      {/* Upload card */}
      <div style={cardS}>
        <label style={labelS}>New Batch — Upload a .zip of Page Photos</label>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 14 }}>
          <div>
            <label style={labelS}>Exam Body</label>
            <select style={inputS} value={config.exam_body} onChange={e => {
              if (e.target.value === ADD_NEW_VALUE) addExamBodyInline(code => set('exam_body', code));
              else set('exam_body', e.target.value);
            }}>
              {examBodies.map(b => <option key={b.id} value={b.code}>{b.name}</option>)}
              <option value={ADD_NEW_VALUE}>+ Add new exam body…</option>
            </select>
          </div>
          <div>
            <label style={labelS}>Year</label>
            <input style={inputS} type="number" value={config.year} onChange={e => set('year', e.target.value)} />
          </div>
          <div>
            <label style={labelS}>Subject</label>
            <select style={inputS} value={config.subject_id} onChange={e => set('subject_id', e.target.value)}>
              <option value="">— Select —</option>
              {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label style={labelS}>Paper Type</label>
            <select style={inputS} value={config.paper_type} onChange={e => set('paper_type', e.target.value)}>
              {PAPER_TYPES.map(p => <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>)}
            </select>
          </div>
          <div>
            <label style={labelS}>Expected Question Count</label>
            <input style={inputS} type="number" placeholder="e.g. 50" value={config.expected_count} onChange={e => set('expected_count', e.target.value)} />
          </div>
        </div>

        <input
          ref={fileRef} type="file" accept=".zip" disabled={uploading}
          onChange={e => handleUpload(e.target.files[0])}
          style={{ display: 'none' }}
        />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading || !config.subject_id}
          style={{
            padding: '12px 20px', borderRadius: 'var(--r-lg)', border: 'none',
            background: uploading || !config.subject_id ? 'var(--bg-raised)' : 'var(--brand-light)',
            color: uploading || !config.subject_id ? 'var(--text-muted)' : '#fff',
            fontWeight: 700, fontSize: 14, cursor: uploading || !config.subject_id ? 'not-allowed' : 'pointer',
          }}
        >
          {uploading ? 'Processing…' : 'Choose .zip and Start Import'}
        </button>
        {!config.subject_id && !uploading && (
          <span style={{ marginLeft: 12, fontSize: 12, color: 'var(--text-muted)' }}>Select a subject first</span>
        )}
        {uploading && (
          <p style={{ marginTop: 12, fontSize: 13, color: 'var(--text-muted)' }}>{uploadStage}</p>
        )}
      </div>

      {/* Diagram repair — for already-published questions whose diagram file
          was lost before a persistent volume was attached. Re-processes the
          original photos and patches existing rows in place; nothing new
          gets inserted. */}
      <div style={{ ...cardS, borderColor: 'var(--warning)' }}>
        <label style={labelS}>🔧 Repair Broken Diagrams</label>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
          If diagrams show broken (404) on already-published questions — usually from files lost before a persistent volume was attached —
          upload the same original photos here. This matches them back to the existing live questions and fixes just the image, without creating duplicates.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 12 }}>
          <div>
            <label style={labelS}>Exam Body</label>
            <select style={inputS} value={repairConfig.exam_body} onChange={e => {
              if (e.target.value === ADD_NEW_VALUE) addExamBodyInline(code => setRepairConfig(c => ({ ...c, exam_body: code })));
              else setRepairConfig(c => ({ ...c, exam_body: e.target.value }));
            }}>
              {examBodies.map(b => <option key={b.id} value={b.code}>{b.name}</option>)}
              <option value={ADD_NEW_VALUE}>+ Add new exam body…</option>
            </select>
          </div>
          <div>
            <label style={labelS}>Year</label>
            <input style={inputS} type="number" placeholder="e.g. 1988" value={repairConfig.year} onChange={e => setRepairConfig(c => ({ ...c, year: e.target.value }))} />
          </div>
          <div>
            <label style={labelS}>Subject (optional, narrows matching)</label>
            <select style={inputS} value={repairConfig.subject_id} onChange={e => setRepairConfig(c => ({ ...c, subject_id: e.target.value }))}>
              <option value="">— Any —</option>
              {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        </div>
        <input ref={repairFileRef} type="file" accept=".zip" disabled={repairing}
          onChange={e => handleRepair(e.target.files[0])} style={{ display: 'none' }} />
        <button onClick={() => repairFileRef.current?.click()} disabled={repairing}
          style={{ padding: '10px 18px', borderRadius: 'var(--r-lg)', border: 'none', background: repairing ? 'var(--bg-raised)' : 'var(--warning)', color: repairing ? 'var(--text-muted)' : '#000', fontWeight: 700, cursor: repairing ? 'not-allowed' : 'pointer' }}>
          {repairing ? 'Repairing…' : 'Choose .zip and Repair Diagrams'}
        </button>
      </div>

      {/* Batch list */}
      <div style={cardS}>
        <label style={labelS}>Recent Batches</label>
        {loading ? (
          <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>Loading…</p>
        ) : batches.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>No batches yet — upload a zip above to start one.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border)' }}>
                  {['Exam', 'Year', 'Subject', 'Paper', 'Extracted', 'Verified', 'Needs Review', 'Conflicts', 'Quality', 'Status', ''].map(h => (
                    <th key={h} style={{ padding: '8px 10px', color: 'var(--text-muted)', fontWeight: 700, fontSize: 11, textTransform: 'uppercase' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {batches.map(b => {
                  const sc = STATUS_COLORS[b.status] || STATUS_COLORS.review;
                  return (
                    <tr key={b.id} style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
                      onClick={() => navigate(`/admin/import/batches/${b.id}`)}>
                      <td style={{ padding: '10px' }}>{b.exam_body}</td>
                      <td style={{ padding: '10px' }}>{b.year}</td>
                      <td style={{ padding: '10px' }}>{b.subject_name || '—'}</td>
                      <td style={{ padding: '10px' }}>{b.paper_type}</td>
                      <td style={{ padding: '10px' }}>{b.extracted_count}</td>
                      <td style={{ padding: '10px', color: 'var(--success)' }}>{b.verified_count}</td>
                      <td style={{ padding: '10px', color: 'var(--warning)' }}>{b.needs_review_count}</td>
                      <td style={{ padding: '10px', color: b.answer_conflict_count ? 'var(--danger)' : 'var(--text-muted)' }}>{b.answer_conflict_count}</td>
                      <td style={{ padding: '10px', fontWeight: 700 }}>{b.quality_score != null ? `${b.quality_score}%` : '—'}</td>
                      <td style={{ padding: '10px' }}>
                        <span style={{ padding: '2px 10px', borderRadius: 'var(--r-full)', background: sc.bg, color: sc.fg, fontWeight: 700, fontSize: 11 }}>
                          {b.status}
                        </span>
                      </td>
                      <td style={{ padding: '10px', color: 'var(--brand-light)', fontWeight: 700 }}>Review →</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
