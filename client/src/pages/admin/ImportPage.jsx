import React, { useState, useRef } from 'react';
import axios from 'axios';
import toast from 'react-hot-toast';
import { importAPI, subjectAPI, questionAPI } from '../../utils/api';
import Button from '../../components/shared/Button';
import MathText from '../../components/MathText';
import styles from './ImportPage.module.css';

const EXAM_BODIES = ['WAEC', 'JAMB', 'NECO', 'NABTEB', 'BECE', 'Post-UTME', 'General'];

export default function ImportPage() {
  const fileRef = useRef(null);
  const [subjects, setSubjects] = useState([]);
  const [step, setStep] = useState('upload'); // upload | preview | done
  const [parsed, setParsed] = useState([]);
  const [errors, setErrors] = useState([]);
  const [result, setResult] = useState(null);
  const [importing, setImporting] = useState(false);
  const [extractWarning, setExtractWarning] = useState('');
  const [importProgress, setImportProgress] = useState('');
  const [batchSummary, setBatchSummary] = useState(null);
  const [numberGaps, setNumberGaps] = useState([]);
  const [paperGroups, setPaperGroups] = useState([]);
  const [downloadingZip, setDownloadingZip] = useState(null);
  const [config, setConfig] = useState({
    exam_body: 'WAEC', year: new Date().getFullYear(), subject_id: '', target_count: 50,
  });

  React.useEffect(() => {
    subjectAPI.list().then(r => setSubjects(r.data.subjects || []));
    loadPaperGroups();
  }, []);

  const loadPaperGroups = () => {
    importAPI.sourcePaperGroups().then(r => setPaperGroups(r.data.groups || [])).catch(() => {});
  };

  const downloadPapersZip = async (examBody, year) => {
    setDownloadingZip(`${examBody}-${year}`);
    try {
      const res = await axios.get(importAPI.sourcePapersZipURL(examBody, year), { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${examBody}-${year}-source-papers.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch { toast.error('Zip download failed'); }
    finally { setDownloadingZip(null); }
  };

  const set = (k, v) => setConfig(c => ({ ...c, [k]: v }));

  const handleFile = async (file) => {
    if (!file) return;
    const ext = file.name.split('.').pop().toLowerCase();

    if (ext === 'zip') {
      setImporting(true);
      setImportProgress('Reading zip contents…');
      try {
        const res = await importAPI.parseZip(file, config.exam_body, config.year, config.subject_id);
        setParsed(res.data.questions || []);
        setErrors([]);
        setExtractWarning(res.data.warning || '');
        setBatchSummary({ perPhoto: res.data.perPhoto || [], duplicatesSkipped: res.data.duplicatesSkipped || 0 });
        setNumberGaps(res.data.numberGaps || []);
        setStep('preview');
        const failedCount = (res.data.perPhoto || []).filter(p => p.error).length;
        if (!res.data.questions?.length) toast.error('No new questions found in that zip');
        else toast.success(
          `${res.data.questions.length} new questions from ${res.data.perPhoto.length} photos` +
          (res.data.duplicatesSkipped ? ` · ${res.data.duplicatesSkipped} duplicates skipped` : '') +
          (failedCount ? ` · ${failedCount} photo${failedCount !== 1 ? 's' : ''} unreadable` : '')
        );
        loadPaperGroups();
      } catch (err) {
        toast.error(err.response?.data?.error || 'Zip import failed');
      } finally {
        setImporting(false);
        setImportProgress('');
      }
      return;
    }

    if (['jpg', 'jpeg', 'png', 'webp'].includes(ext)) {
      setImporting(true);
      try {
        const res = await importAPI.parseImage(file, config.exam_body, config.year, config.subject_id);
        setParsed(res.data.questions || []);
        setErrors([]);
        setExtractWarning(res.data.warning || '');
        setBatchSummary(null);
        setNumberGaps([]);
        setStep('preview');
        if (!res.data.questions?.length) toast.error('No questions could be read from that image');
        else toast.success(`${res.data.questions.length} questions read from image — check each one${res.data.archived ? ' (photo archived)' : ''}`);
        if (res.data.archived) loadPaperGroups();
      } catch (err) {
        toast.error(err.response?.data?.error || 'Image scan failed');
      } finally {
        setImporting(false);
      }
      return;
    }

    const text = await file.text();

    try {
      if (ext === 'json') {
        const data = JSON.parse(text);
        const questions = Array.isArray(data) ? data : data.questions;
        if (!Array.isArray(questions)) return toast.error('JSON must be an array or {questions:[...]}');
        setParsed(questions);
        setErrors([]);
        setExtractWarning('');
        setBatchSummary(null);
        setNumberGaps([]);
        setStep('preview');
      } else if (ext === 'csv') {
        const res = await importAPI.parseCSV(text);
        setParsed(res.data.questions || []);
        setErrors(res.data.errors || []);
        setExtractWarning('');
        setBatchSummary(null);
        setNumberGaps([]);
        setStep('preview');
        if (res.data.errors?.length) toast(`${res.data.errors.length} rows skipped — check errors below`);
      } else {
        toast.error('Only .csv, .json, .jpg, .jpeg, .png, .webp, or .zip files supported');
      }
    } catch (err) {
      toast.error('File parse error: ' + err.message);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const handleImport = async () => {
    if (!parsed.length) return toast.error('No questions to import');
    setImporting(true);
    try {
      const res = await importAPI.questions({
        questions: parsed,
        exam_body: config.exam_body,
        year: config.year,
        subject_id: config.subject_id || undefined,
      });
      setResult(res.data);
      setStep('done');
      toast.success(`${res.data.success} questions imported!`);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Import failed');
    } finally { setImporting(false); }
  };

  const reset = () => { setParsed([]); setErrors([]); setResult(null); setExtractWarning(''); setBatchSummary(null); setNumberGaps([]); setStep('upload'); };

  const setCorrectAnswer = (rowIdx, option) => {
    setParsed(prev => prev.map((q, i) => i === rowIdx ? { ...q, correct_answers: [option] } : q));
  };

  const needsAnswer = parsed.filter(q => !q.correct_answers?.length).length;
  const presentNumbers = new Set(
    parsed.filter(q => q.question_type !== 'essay' && q.source_number != null).map(q => q.source_number)
  );
  const missingNumbers = presentNumbers.size > 0
    ? Array.from({ length: config.target_count }, (_, i) => i + 1).filter(n => !presentNumbers.has(n))
    : [];

  const [addModalNumber, setAddModalNumber] = useState(null); // number being added, or 'new' for a free-form add

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Import Past Questions</h1>
          <p className={styles.sub}>Upload WAEC, JAMB, NECO, NABTEB past questions via CSV, JSON, or a photo of the question paper</p>
        </div>
        <a href="/api/import/template" className={styles.templateLink} download>
          ↓ Download CSV Template
        </a>
      </div>

      {/* Info banner */}
      <div className={styles.infoBanner}>
        <div className={styles.infoIcon}>ℹ</div>
        <div className={styles.infoText}>
          <strong>How this works:</strong> Manually collect past questions from official WAEC/JAMB/NECO/NABTEB question papers,
          enter them into the CSV template or JSON format, then upload here — or snap a photo of a question paper page and let AI read
          it into the format for you. This is the official, legal way to build your question bank.
          WAEC, JAMB, NECO and NABTEB do not offer public APIs.
        </div>
      </div>

      {/* Step: Upload */}
      {step === 'upload' && (
        <div className={styles.uploadWrap}>
          {/* Config */}
          <div className={styles.configRow}>
            <div className={styles.configField}>
              <label className={styles.label}>Exam Body</label>
              <select value={config.exam_body} onChange={e => set('exam_body', e.target.value)}>
                {EXAM_BODIES.map(b => <option key={b}>{b}</option>)}
              </select>
            </div>
            <div className={styles.configField}>
              <label className={styles.label}>Year</label>
              <input
                type="number" min={1980} max={2030}
                value={config.year} onChange={e => set('year', Number(e.target.value))}
              />
            </div>
            <div className={styles.configField}>
              <label className={styles.label}>Subject <span className={styles.labelHint}>(optional override)</span></label>
              <select value={config.subject_id} onChange={e => set('subject_id', e.target.value)}>
                <option value="">Use per-question subject_code</option>
                {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div className={styles.configField}>
              <label className={styles.label}>Objective Total <span className={styles.labelHint}>(for gap-filling)</span></label>
              <input
                type="number" min={1} max={200}
                value={config.target_count} onChange={e => set('target_count', Number(e.target.value))}
              />
            </div>
          </div>

          {/* Drop zone */}
          <div
            className={styles.dropZone}
            onDrop={handleDrop}
            onDragOver={e => e.preventDefault()}
            onClick={() => !importing && fileRef.current?.click()}
          >
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.json,.jpg,.jpeg,.png,.webp,.zip"
              style={{ display: 'none' }}
              disabled={importing}
              onChange={e => handleFile(e.target.files[0])}
            />
            <div className={styles.dropIcon}>{importing ? '🔎' : '📁'}</div>
            <div className={styles.dropTitle}>{importing ? (importProgress || 'Reading questions…') : 'Drop CSV, JSON, a photo, or a zip of photos here'}</div>
            <div className={styles.dropSub}>{importing ? 'A full zip can take a few minutes — one AI read per photo' : 'or click to browse · JPG/PNG/WEBP for one page · .zip for a whole year at once (max 60 photos)'}</div>
          </div>

          <div className={styles.formatNote} style={{ marginBottom: 20 }}>
            <strong>📷 Photo import:</strong> Take a clear, well-lit photo of one question-paper page at a time. AI reads the questions and options,
            but it does <strong>not</strong> guess correct answers unless the paper shows a marked answer key — you'll mark each correct answer
            yourself in the preview step before importing. Always double-check the transcribed text against the original paper.
            <br /><br />
            <strong>📦 Whole year at once:</strong> Set Exam Body and Year above, then zip all of that year's page photos together and drop the zip here.
            Every photo is read individually, archived, and checked against what's already in your question bank — exact duplicates are skipped automatically, so re-uploading a year you've already added won't clutter it up.
          </div>

          {/* Format guide */}
          <div className={styles.formatGuide}>
            <div className={styles.formatTitle}>CSV Format (recommended)</div>
            <div className={styles.formatCode}>
              question_text, option_a, option_b, option_c, option_d, correct_answer, explanation, difficulty, marks, tags, year, subject_code, image_url
            </div>
            <div className={styles.formatTitle} style={{ marginTop: 16 }}>JSON Format</div>
            <div className={styles.formatCode}>
              {`[{"question_text":"...","options":["A","B","C","D"],"correct_answers":["A"],"explanation":"...","difficulty":"medium","marks":1,"tags":["WAEC","2023"],"subject_code":"MTH","image_url":"https://..."}]`}
            </div>
            <div className={styles.formatNote}>
              <strong>correct_answer</strong> in CSV: Use "A", "B", "C", or "D" (letter) — or the full option text.
              <br /><strong>tags</strong>: Separate multiple tags with semicolons in CSV (e.g. WAEC;Algebra;2023)
              <br /><strong>image_url</strong>: Optional — a hosted image link for diagrams, graphs, or structures (e.g. a Biology cell diagram). Leave blank if the question has no image. Upload images to your own storage first, then paste the link here — bulk import doesn't upload image files directly.
            </div>
          </div>

          {/* Archived source papers, grouped by exam body + year */}
          {paperGroups.length > 0 && (
            <div className={styles.formatBlock} style={{ marginTop: 20 }}>
              <div className={styles.formatTitle}>📁 Archived Source Papers</div>
              <div className={styles.formatNote} style={{ marginBottom: 12 }}>
                Every photo you've uploaded is kept here, organized by exam body and year, so you can pull up or share the original pages any time.
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {paperGroups.map(g => (
                  <div key={`${g.exam_body}-${g.year}`} style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '10px 14px', background: 'var(--bg-raised)', borderRadius: 'var(--r)',
                  }}>
                    <div>
                      <strong>{g.exam_body}</strong> · {g.year}
                      <span style={{ color: 'var(--text-muted)', fontSize: 12, marginLeft: 8 }}>
                        {g.count} photo{g.count !== 1 ? 's' : ''}
                      </span>
                    </div>
                    <Button
                      size="xs"
                      variant="ghost"
                      loading={downloadingZip === `${g.exam_body}-${g.year}`}
                      onClick={() => downloadPapersZip(g.exam_body, g.year)}
                    >
                      ⬇ Download Zip
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Step: Preview */}
      {step === 'preview' && (
        <div>
          <div className={styles.previewHeader}>
            <div className={styles.previewStats}>
              <span className={styles.statGreen}>✓ {parsed.length} questions ready to import</span>
              {errors.length > 0 && <span className={styles.statRed}>✕ {errors.length} rows skipped</span>}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <Button variant="ghost" onClick={reset}>← Back</Button>
              <Button onClick={handleImport} loading={importing}>
                Import {parsed.length} Questions →
              </Button>
            </div>
          </div>

          {/* Config summary */}
          <div className={styles.configSummary}>
            Importing as: <strong>{config.exam_body}</strong> · Year: <strong>{config.year}</strong>
            {config.subject_id && ` · Subject override: ${subjects.find(s => s.id === config.subject_id)?.name}`}
          </div>

          {/* AI image-extraction warning */}
          {extractWarning && (
            <div className={styles.formatNote} style={{ marginBottom: 16 }}>
              <strong>⚠ Review before importing:</strong> {extractWarning}
            </div>
          )}

          {/* Missing question numbers — fill them right here */}
          {missingNumbers.length > 0 && (
            <div className={styles.errorBlock} style={{ marginBottom: 16 }}>
              <div className={styles.errorTitle}>
                ⚠ {missingNumbers.length} of {config.target_count} objective questions still missing
              </div>
              <div className={styles.errorItem} style={{ marginBottom: 10 }}>
                Some may have been skipped while reading a multi-column page, others may just not have been on any photo you uploaded. Click a number to add that question by hand, diagram included if it needs one.
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {missingNumbers.map(n => (
                  <button key={n} onClick={() => setAddModalNumber(n)} style={{
                    padding: '4px 10px', borderRadius: 'var(--r)', fontSize: 12, fontWeight: 700,
                    border: '1.5px solid var(--danger)', background: 'var(--danger-dim)', color: 'var(--danger)', cursor: 'pointer',
                  }}>+ #{n}</button>
                ))}
              </div>
            </div>
          )}

          <div style={{ marginBottom: 16 }}>
            <Button size="sm" variant="ghost" onClick={() => setAddModalNumber('new')}>+ Add Question Manually</Button>
          </div>

          {addModalNumber !== null && (
            <ManualQuestionModal
              defaultNumber={addModalNumber === 'new' ? '' : addModalNumber}
              onClose={() => setAddModalNumber(null)}
              onSave={(q) => {
                setParsed(prev => {
                  const withoutDup = prev.filter(p => p.source_number !== q.source_number || q.source_number == null);
                  return [...withoutDup, q].sort((a, b) => (a.source_number ?? 9999) - (b.source_number ?? 9999));
                });
                setAddModalNumber(null);
                toast.success(q.source_number ? `Question #${q.source_number} added` : 'Question added');
              }}
            />
          )}

          {/* Zip batch summary */}
          {batchSummary && (
            <div className={styles.formatBlock} style={{ marginBottom: 16 }}>
              <div className={styles.formatTitle}>
                📦 Batch results — {batchSummary.perPhoto.length} photos
                {batchSummary.duplicatesSkipped > 0 && `, ${batchSummary.duplicatesSkipped} duplicates skipped`}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8, maxHeight: 180, overflowY: 'auto' }}>
                {batchSummary.perPhoto.map((p, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, padding: '4px 0', color: p.error ? 'var(--danger)' : 'var(--text-secondary)' }}>
                    <span>{p.filename}</span>
                    <span>{p.error || `${p.kept} question${p.kept !== 1 ? 's' : ''}${p.extracted !== p.kept ? ` (${p.extracted - p.kept} duplicate${p.extracted - p.kept !== 1 ? 's' : ''} skipped)` : ''}`}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Needs-answer warning */}
          {needsAnswer > 0 && (
            <div className={styles.errorBlock}>
              <div className={styles.errorTitle}>⚠ {needsAnswer} question{needsAnswer !== 1 ? 's' : ''} still need{needsAnswer === 1 ? 's' : ''} a correct answer marked</div>
              <div className={styles.errorItem}>Click an option below to mark it correct for that row before importing.</div>
            </div>
          )}

          {/* Parse errors */}
          {errors.length > 0 && (
            <div className={styles.errorBlock}>
              <div className={styles.errorTitle}>⚠ {errors.length} rows skipped</div>
              {errors.map((e, i) => (
                <div key={i} className={styles.errorItem}>Row {e.row}: {e.error}</div>
              ))}
            </div>
          )}

          {/* Preview table */}
          <div className={styles.previewTable}>
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th></th>
                  <th>Question</th>
                  <th>Options {extractWarning && <span style={{ fontWeight: 400 }}>(click to mark correct)</span>}</th>
                  <th>Correct</th>
                  <th>Diff</th>
                  <th>Subj</th>
                </tr>
              </thead>
              <tbody>
                {parsed.map((q, i) => (
                  <tr key={i}>
                    <td className={styles.rowNum}>
                      {q.source_number != null ? <>#{q.source_number}</> : i + 1}
                    </td>
                    <td>
                      {(q.image_url || q.media_url) && (
                        <img src={q.image_url || q.media_url} alt="" style={{ width: 32, height: 32, objectFit: 'cover', borderRadius: 4 }} title="Has image" />
                      )}
                    </td>
                    <td className={styles.qCell}><MathText text={q.question_text} inline /></td>
                    <td className={styles.optsCell}>
                      {(q.options || []).map((opt, oi) => (
                        <span
                          key={oi}
                          onClick={() => setCorrectAnswer(i, opt)}
                          className={`${styles.optBadge} ${q.correct_answers?.includes(opt) ? styles.optCorrect : ''}`}
                          style={{ cursor: 'pointer' }}
                          title="Click to mark as correct answer"
                        >
                          {String.fromCharCode(65 + oi)}) <MathText text={opt.slice(0, 30)} inline />{opt.length > 30 ? '…' : ''}
                        </span>
                      ))}
                    </td>
                    <td className={styles.correctCell}>
                      {(q.correct_answers || []).map((a, ai) => (
                        <span key={ai} className={styles.correctBadge}>{a.slice(0, 20)}</span>
                      ))}
                      {q.explanation && (
                        <span title={q.explanation} style={{ marginLeft: 6, fontSize: 12, cursor: 'help' }}>📝</span>
                      )}
                    </td>
                    <td>
                      <span className={`tag tag-${q.difficulty === 'easy' ? 'green' : q.difficulty === 'hard' ? 'red' : 'amber'}`}>
                        {q.difficulty || 'med'}
                      </span>
                    </td>
                    <td className={styles.subjCell}>{q.subject_code || q.subject_hint || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Step: Done */}
      {step === 'done' && result && (
        <div className={styles.doneWrap}>
          <div className={styles.doneIcon}>✓</div>
          <h2 className={styles.doneTitle}>Import Complete</h2>
          <div className={styles.doneStats}>
            <div className={styles.doneStat}>
              <div className={styles.doneStatVal} style={{ color: 'var(--green)' }}>{result.success}</div>
              <div className={styles.doneStatLabel}>Imported</div>
            </div>
            <div className={styles.doneStat}>
              <div className={styles.doneStatVal} style={{ color: 'var(--red)' }}>{result.failed}</div>
              <div className={styles.doneStatLabel}>Failed</div>
            </div>
          </div>
          {result.errors?.length > 0 && (
            <div className={styles.errorBlock} style={{ maxWidth: 600, margin: '16px auto' }}>
              <div className={styles.errorTitle}>Failed rows:</div>
              {result.errors.map((e, i) => (
                <div key={i} className={styles.errorItem}>Row {e.row}: {e.error} — "{e.question}"</div>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', marginTop: 24 }}>
            <Button variant="ghost" onClick={reset}>Import More</Button>
            <Button onClick={() => window.location.href = '/admin/questions'}>View Question Bank →</Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── ADD A QUESTION MANUALLY (fill a gap left by the scan, diagram included) ──
function ManualQuestionModal({ defaultNumber, onClose, onSave }) {
  const [sourceNumber, setSourceNumber] = useState(defaultNumber);
  const [questionText, setQuestionText] = useState('');
  const [options, setOptions] = useState(['', '', '', '']);
  const [correctIdx, setCorrectIdx] = useState(null);
  const [explanation, setExplanation] = useState('');
  const [difficulty, setDifficulty] = useState('medium');
  const [mediaUrl, setMediaUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);

  const setOption = (i, val) => setOptions(prev => prev.map((o, idx) => idx === i ? val : o));
  const addOption = () => { if (options.length < 5) setOptions(prev => [...prev, '']); };

  const handleImageUpload = async (file) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) return toast.error('Please choose an image file');
    if (file.size > 5 * 1024 * 1024) return toast.error('Image must be under 5MB');
    setUploading(true);
    try {
      const res = await questionAPI.uploadImage(file);
      setMediaUrl(res.data.url);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Image upload failed');
    } finally { setUploading(false); }
  };

  const handleSave = () => {
    if (!questionText.trim()) return toast.error('Question text is required');
    const filledOptions = options.map(o => o.trim()).filter(Boolean);
    if (filledOptions.length < 2) return toast.error('Add at least 2 options');
    if (correctIdx === null || !options[correctIdx]?.trim()) return toast.error('Mark which option is correct');

    onSave({
      question_text: questionText.trim(),
      question_type: 'mcq',
      options: filledOptions,
      correct_answers: [options[correctIdx].trim()],
      explanation: explanation.trim(),
      difficulty,
      marks: 1,
      tags: [],
      media_url: mediaUrl || null,
      source_number: sourceNumber === '' ? null : Number(sourceNumber),
    });
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(6px)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-md)', borderRadius: 'var(--r-xl)', width: 520, maxHeight: '88vh', overflowY: 'auto', padding: 26, boxShadow: 'var(--shadow-lg)' }}>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 17, fontWeight: 800, marginBottom: 18 }}>
          {defaultNumber ? `Add Question #${defaultNumber}` : 'Add Question'}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label className={styles.label}>Question Number <span className={styles.labelHint}>(as printed on the paper)</span></label>
            <input type="number" min={1} value={sourceNumber} onChange={e => setSourceNumber(e.target.value)} style={{ width: 100 }} />
          </div>

          <div>
            <label className={styles.label}>Question Text</label>
            <textarea rows={3} value={questionText} onChange={e => setQuestionText(e.target.value)} placeholder="Type or paste the question exactly as printed…" />
          </div>

          <div>
            <label className={styles.label}>Diagram / Image <span className={styles.labelHint}>(optional)</span></label>
            {mediaUrl ? (
              <div style={{ position: 'relative', display: 'inline-block' }}>
                <img src={mediaUrl} alt="" style={{ maxWidth: '100%', maxHeight: 180, borderRadius: 8, border: '1px solid var(--border)', display: 'block' }} />
                <button type="button" onClick={() => setMediaUrl('')} style={{ position: 'absolute', top: 6, right: 6, background: 'rgba(0,0,0,0.65)', color: '#fff', border: 'none', borderRadius: 6, width: 24, height: 24, cursor: 'pointer' }}>✕</button>
              </div>
            ) : (
              <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, border: '1.5px dashed var(--border-md)', borderRadius: 8, padding: '14px', cursor: uploading ? 'default' : 'pointer', color: 'var(--text-muted)', fontSize: 12.5 }}>
                {uploading ? 'Uploading…' : '📷 Click to add a diagram for this question'}
                <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} disabled={uploading} onChange={e => handleImageUpload(e.target.files[0])} />
              </label>
            )}
          </div>

          <div>
            <label className={styles.label}>Options <span className={styles.labelHint}>(click one to mark it correct)</span></label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {options.map((opt, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <button type="button" onClick={() => setCorrectIdx(i)} style={{
                    width: 26, height: 26, flexShrink: 0, borderRadius: '50%', fontSize: 12, fontWeight: 800, cursor: 'pointer',
                    border: `2px solid ${correctIdx === i ? 'var(--success)' : 'var(--border-md)'}`,
                    background: correctIdx === i ? 'var(--success)' : 'transparent',
                    color: correctIdx === i ? '#fff' : 'var(--text-muted)',
                  }}>{String.fromCharCode(65 + i)}</button>
                  <input value={opt} onChange={e => setOption(i, e.target.value)} placeholder={`Option ${String.fromCharCode(65 + i)}`} style={{ flex: 1 }} />
                </div>
              ))}
            </div>
            {options.length < 5 && (
              <button type="button" onClick={addOption} style={{ marginTop: 6, background: 'none', border: 'none', color: 'var(--brand-light)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>+ Add option E</button>
            )}
          </div>

          <div>
            <label className={styles.label}>Explanation <span className={styles.labelHint}>(optional)</span></label>
            <textarea rows={2} value={explanation} onChange={e => setExplanation(e.target.value)} placeholder="Worked solution, if you have one…" />
          </div>

          <div>
            <label className={styles.label}>Difficulty</label>
            <select value={difficulty} onChange={e => setDifficulty(e.target.value)} style={{ width: 140 }}>
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
            </select>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 22 }}>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave}>Add Question</Button>
        </div>
      </div>
    </div>
  );
}
