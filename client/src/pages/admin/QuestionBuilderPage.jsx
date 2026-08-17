import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { questionAPI } from '../../utils/api';
import Button from '../../components/shared/Button';
import styles from './QuestionBuilderPage.module.css';

const QUESTION_TYPES = [
  { id: 'mcq', label: 'MCQ', icon: '◉' },
  { id: 'multi_answer', label: 'Multi-Answer', icon: '☑' },
  { id: 'true_false', label: 'True / False', icon: '⊕' },
  { id: 'essay', label: 'Essay', icon: '✎' },
  { id: 'fill_blank', label: 'Fill Blank', icon: '▭' },
  { id: 'coding', label: 'Coding', icon: '</>' },
];

const DIFFICULTIES = ['easy', 'medium', 'hard'];
const OPTION_LETTERS = ['A', 'B', 'C', 'D', 'E'];

export default function QuestionBuilderPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isEdit = !!id;

  const [subjects, setSubjects] = useState([]);
  const [saving, setSaving] = useState(false);
  const [aiGenerating, setAiGenerating] = useState(false);

  const [form, setForm] = useState({
    question_type: 'mcq',
    question_text: '',
    media_url: '',
    options: ['', '', '', ''],
    correct_answers: [],
    explanation: '',
    difficulty: 'medium',
    marks: 1,
    subject_id: '',
    tags: [],
    exam_types: [],
  });

  const [tagInput, setTagInput] = useState('');
  const [aiConfig, setAiConfig] = useState({ topic: '', count: 5 });
  const [imageUploading, setImageUploading] = useState(false);

  useEffect(() => {
    questionAPI.subjects().then(r => setSubjects(r.data.subjects));
    if (isEdit) loadQuestion();
  }, [id]);

  const loadQuestion = async () => {
    try {
      const res = await questionAPI.get(id);
      const q = res.data.question;
      setForm({
        ...q,
        options: JSON.parse(q.options || '[]'),
        correct_answers: JSON.parse(q.correct_answers || '[]'),
        tags: JSON.parse(q.tags || '[]'),
        exam_types: JSON.parse(q.exam_types || '[]'),
      });
    } catch { toast.error('Failed to load question'); }
  };

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }));

  const setOption = (idx, val) => {
    const opts = [...form.options];
    opts[idx] = val;
    set('options', opts);
  };

  const toggleCorrect = (opt) => {
    if (form.question_type === 'mcq' || form.question_type === 'true_false') {
      set('correct_answers', [opt]);
    } else {
      const ca = form.correct_answers.includes(opt)
        ? form.correct_answers.filter(c => c !== opt)
        : [...form.correct_answers, opt];
      set('correct_answers', ca);
    }
  };

  const addOption = () => {
    if (form.options.length < 5) set('options', [...form.options, '']);
  };
  const removeOption = (idx) => {
    const opts = form.options.filter((_, i) => i !== idx);
    set('options', opts);
  };

  const addTag = (e) => {
    if ((e.key === 'Enter' || e.key === ',') && tagInput.trim()) {
      e.preventDefault();
      set('tags', [...form.tags, tagInput.trim()]);
      setTagInput('');
    }
  };
  const removeTag = (t) => set('tags', form.tags.filter(tag => tag !== t));

  const handleSave = async () => {
    if (!form.question_text.trim()) return toast.error('Question text required');
    if (['mcq','true_false','multi_answer'].includes(form.question_type) && form.correct_answers.length === 0) {
      return toast.error('Mark at least one correct answer');
    }

    setSaving(true);
    try {
      const payload = {
        ...form,
        options: form.question_type === 'true_false' ? ['True', 'False'] : form.options.filter(Boolean),
      };
      if (isEdit) {
        await questionAPI.update(id, payload);
        toast.success('Question updated');
      } else {
        await questionAPI.create(payload);
        toast.success('Question saved to bank ✓');
        navigate('/admin/questions');
      }
    } catch (err) {
      toast.error(err.response?.data?.error || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleImageUpload = async (file) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) return toast.error('Please choose an image file');
    if (file.size > 5 * 1024 * 1024) return toast.error('Image must be under 5MB');
    setImageUploading(true);
    try {
      const res = await questionAPI.uploadImage(file);
      set('media_url', res.data.url);
      toast.success('Image attached');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Image upload failed');
    } finally {
      setImageUploading(false);
    }
  };

  const handleAiGenerate = async () => {
    if (!aiConfig.topic || !form.subject_id) return toast.error('Select subject and enter topic first');
    const subject = subjects.find(s => s.id === form.subject_id);
    setAiGenerating(true);
    try {
      const res = await questionAPI.aiGenerate({
        subject: subject?.name,
        topic: aiConfig.topic,
        difficulty: form.difficulty,
        count: aiConfig.count,
        exam_type: form.exam_types[0],
      });
      const first = res.data.questions?.[0];
      if (first) {
        setForm(f => ({
          ...f,
          question_text: first.question_text,
          options: first.options || [],
          correct_answers: first.correct_answers || [],
          explanation: first.explanation || '',
          tags: first.tags || [],
        }));
        toast.success(`Generated ${res.data.questions.length} questions. Loaded first one.`);
        if (res.data.questions.length > 1) {
          toast.success('Save this and refresh bank to see all generated questions', { duration: 4000 });
          // Bulk save the rest
          const rest = res.data.questions.slice(1).map(q => ({
            ...q, subject_id: form.subject_id, difficulty: form.difficulty,
            marks: form.marks, exam_types: form.exam_types,
          }));
          await questionAPI.bulkUpload(rest);
        }
      }
    } catch (err) {
      toast.error(err.response?.data?.error || 'AI generation failed. Check your API key.');
    } finally {
      setAiGenerating(false);
    }
  };

  const renderOptions = () => {
    if (form.question_type === 'true_false') {
      return ['True', 'False'].map((opt, i) => (
        <div key={opt} className={`${styles.optRow} ${form.correct_answers.includes(opt) ? styles.optCorrect : ''}`}>
          <button className={styles.optLetter} onClick={() => toggleCorrect(opt)}>
            {form.correct_answers.includes(opt) ? '✓' : OPTION_LETTERS[i]}
          </button>
          <span className={styles.optFixed}>{opt}</span>
        </div>
      ));
    }

    if (form.question_type === 'essay' || form.question_type === 'coding') {
      return (
        <div className={styles.essayNote}>
          <div className={styles.essayIcon}>{form.question_type === 'coding' ? '</>' : '✎'}</div>
          <div>
            <div className={styles.essayTitle}>{form.question_type === 'coding' ? 'Coding Question' : 'Essay Question'}</div>
            <div className={styles.essaySub}>Candidates type their answer. Use the explanation field as a marking guide.</div>
          </div>
        </div>
      );
    }

    return (
      <>
        {form.options.map((opt, i) => (
          <div key={i} className={`${styles.optRow} ${form.correct_answers.includes(opt) ? styles.optCorrect : ''}`}>
            <button
              className={`${styles.optLetter} ${form.correct_answers.includes(opt) ? styles.optLetterCorrect : ''}`}
              onClick={() => opt && toggleCorrect(opt)}
              title="Mark as correct"
            >
              {form.correct_answers.includes(opt) ? '✓' : OPTION_LETTERS[i]}
            </button>
            <input
              className={styles.optInput}
              placeholder={`Option ${OPTION_LETTERS[i]}`}
              value={opt}
              onChange={e => setOption(i, e.target.value)}
            />
            {form.options.length > 2 && (
              <button className={styles.optRemove} onClick={() => removeOption(i)}>✕</button>
            )}
          </div>
        ))}
        {form.options.length < 5 && (
          <button className={styles.addOpt} onClick={addOption}>+ Add option</button>
        )}
        {form.correct_answers.length > 0 && (
          <div className={styles.correctNote}>
            ✓ Correct: {form.correct_answers.join(', ')}
          </div>
        )}
      </>
    );
  };

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>{isEdit ? 'Edit Question' : 'New Question'}</h1>
          <p className={styles.pageSub}>Question Bank · {isEdit ? 'Updating version' : 'Author a new question'}</p>
        </div>
        <div className={styles.headerActions}>
          <Button variant="ghost" onClick={() => navigate('/admin/questions')}>Cancel</Button>
          <Button variant="ghost" onClick={() => toast('Preview coming soon')}>Preview</Button>
          <Button onClick={handleSave} loading={saving}>
            {isEdit ? 'Update Question' : 'Save to Bank'}
          </Button>
        </div>
      </div>

      {/* Type selector */}
      <div className={styles.typeBar}>
        <span className={styles.typeLabel}>Type:</span>
        {QUESTION_TYPES.map(t => (
          <button
            key={t.id}
            className={`${styles.typePill} ${form.question_type === t.id ? styles.typePillActive : ''}`}
            onClick={() => set('question_type', t.id)}
          >
            <span>{t.icon}</span> {t.label}
          </button>
        ))}
      </div>

      <div className={styles.builderGrid}>
        {/* Main editor */}
        <div className={styles.main}>
          {/* AI Generate block */}
          <div className={styles.aiBlock}>
            <div className={styles.aiHeader}>
              <div className={styles.aiTitle}>✦ AI Question Generator</div>
              <span className={styles.aiPowered}>Powered by Claude</span>
            </div>
            <div className={styles.aiRow}>
              <input
                placeholder="Topic (e.g., Profit and Loss, Newton's Laws...)"
                value={aiConfig.topic}
                onChange={e => setAiConfig(c => ({ ...c, topic: e.target.value }))}
                style={{ flex: 1 }}
              />
              <select
                value={aiConfig.count}
                onChange={e => setAiConfig(c => ({ ...c, count: Number(e.target.value) }))}
                style={{ width: 90 }}
              >
                {[1,3,5,10].map(n => <option key={n} value={n}>{n} Qs</option>)}
              </select>
              <Button
                variant="ghost"
                onClick={handleAiGenerate}
                loading={aiGenerating}
                icon="✦"
              >
                Generate
              </Button>
            </div>
          </div>

          {/* Question text */}
          <div className={styles.field}>
            <label className={styles.fieldLabel}>Question Text</label>
            <textarea
              placeholder="Type your question here..."
              value={form.question_text}
              onChange={e => set('question_text', e.target.value)}
              rows={4}
            />
          </div>

          {/* Image / diagram */}
          <div className={styles.field}>
            <label className={styles.fieldLabel}>
              Diagram / Image <span className={styles.fieldHint}> · Optional — for Biology, graphs, charts, chemical structures, etc.</span>
            </label>
            {form.media_url ? (
              <div style={{ position: 'relative', display: 'inline-block' }}>
                <img
                  src={form.media_url}
                  alt="Question diagram"
                  style={{ maxWidth: '100%', maxHeight: 280, borderRadius: 8, border: '1px solid var(--border, #ddd)', display: 'block' }}
                />
                <button
                  type="button"
                  onClick={() => set('media_url', '')}
                  style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(0,0,0,0.65)', color: '#fff', border: 'none', borderRadius: 6, width: 26, height: 26, cursor: 'pointer' }}
                  title="Remove image"
                >✕</button>
              </div>
            ) : (
              <label
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  border: '1.5px dashed var(--border, #ccc)', borderRadius: 8, padding: '20px 16px',
                  cursor: imageUploading ? 'default' : 'pointer', color: 'var(--text-muted, #888)', fontSize: 13,
                }}
              >
                {imageUploading ? 'Uploading…' : '📷 Click to upload an image or diagram'}
                <input
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  disabled={imageUploading}
                  onChange={e => handleImageUpload(e.target.files[0])}
                />
              </label>
            )}
          </div>

          {/* Options */}
          <div className={styles.field}>
            <label className={styles.fieldLabel}>
              Answer Options
              {['mcq','true_false'].includes(form.question_type) && (
                <span className={styles.fieldHint}> · Click letter to mark correct</span>
              )}
              {form.question_type === 'multi_answer' && (
                <span className={styles.fieldHint}> · Click letters to mark multiple correct</span>
              )}
            </label>
            <div className={styles.options}>{renderOptions()}</div>
          </div>

          {/* Explanation */}
          <div className={styles.field}>
            <label className={styles.fieldLabel}>
              Explanation / Marking Guide
              <span className={styles.fieldHint}> · Shown after exam or used for AI grading</span>
            </label>
            <textarea
              placeholder="Explain the correct answer or provide marking criteria..."
              value={form.explanation}
              onChange={e => set('explanation', e.target.value)}
              rows={3}
            />
          </div>
        </div>

        {/* Side panel */}
        <div className={styles.panel}>
          <div className={styles.panelSection}>
            <div className={styles.panelTitle}>Classification</div>
            <div className={styles.panelField}>
              <label className={styles.fieldLabel}>Subject</label>
              <select value={form.subject_id} onChange={e => set('subject_id', e.target.value)}>
                <option value="">Select subject...</option>
                {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div className={styles.panelRow}>
              <div className={styles.panelField}>
                <label className={styles.fieldLabel}>Difficulty</label>
                <select value={form.difficulty} onChange={e => set('difficulty', e.target.value)}>
                  {DIFFICULTIES.map(d => <option key={d} value={d}>{d.charAt(0).toUpperCase() + d.slice(1)}</option>)}
                </select>
              </div>
              <div className={styles.panelField}>
                <label className={styles.fieldLabel}>Marks</label>
                <input type="number" min={0.5} max={100} step={0.5} value={form.marks}
                  onChange={e => set('marks', Number(e.target.value))} />
              </div>
            </div>
          </div>

          <div className={styles.panelSection}>
            <div className={styles.panelTitle}>Tags</div>
            <div className={styles.tagsBox}>
              {form.tags.map(t => (
                <span key={t} className={styles.tagChip}>
                  {t}
                  <button onClick={() => removeTag(t)}>✕</button>
                </span>
              ))}
              <input
                className={styles.tagInput}
                placeholder="Add tag, Enter..."
                value={tagInput}
                onChange={e => setTagInput(e.target.value)}
                onKeyDown={addTag}
              />
            </div>
          </div>

          <div className={styles.panelSection}>
            <div className={styles.panelTitle}>Exam Types</div>
            {['WAEC', 'JAMB', 'NECO', 'Post-UTME', 'General'].map(et => (
              <label key={et} className={styles.checkRow}>
                <input
                  type="checkbox"
                  checked={form.exam_types.includes(et)}
                  onChange={e => {
                    const types = e.target.checked
                      ? [...form.exam_types, et]
                      : form.exam_types.filter(t => t !== et);
                    set('exam_types', types);
                  }}
                />
                <span>{et}</span>
              </label>
            ))}
          </div>

          <div className={styles.panelSection}>
            <div className={styles.panelTitle}>Settings</div>
            <label className={styles.checkRow}>
              <input type="checkbox" defaultChecked />
              <span>Shuffle options</span>
            </label>
            <label className={styles.checkRow}>
              <input type="checkbox" defaultChecked />
              <span>Allow candidate flagging</span>
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}
