import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { subjectAPI } from '../../utils/api';
import Button from '../../components/shared/Button';
import styles from './SubjectsPage.module.css';

const EMPTY_FORM = { name: '', code: '', description: '' };

export default function SubjectsPage() {
  const [subjects, setSubjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editTarget, setEditTarget] = useState(null); // null = new
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(null);

  useEffect(() => { load(); }, []);

  const load = async () => {
    setLoading(true);
    try {
      const res = await subjectAPI.list();
      setSubjects(res.data.subjects || []);
    } catch { toast.error('Failed to load subjects'); }
    finally { setLoading(false); }
  };

  const openAdd = () => {
    setEditTarget(null);
    setForm(EMPTY_FORM);
    setShowModal(true);
  };

  const openEdit = (subject) => {
    setEditTarget(subject);
    setForm({ name: subject.name, code: subject.code, description: subject.description || '' });
    setShowModal(true);
  };

  const closeModal = () => { setShowModal(false); setEditTarget(null); setForm(EMPTY_FORM); };

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }));

  // Auto-generate code from name
  const handleNameChange = (val) => {
    set('name', val);
    if (!editTarget) {
      const autoCode = val.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 4);
      set('code', autoCode);
    }
  };

  const handleSave = async () => {
    if (!form.name.trim()) return toast.error('Subject name required');
    if (!form.code.trim()) return toast.error('Subject code required');
    setSaving(true);
    try {
      if (editTarget) {
        await subjectAPI.update(editTarget.id, form);
        toast.success('Subject updated');
      } else {
        await subjectAPI.create(form);
        toast.success(`Subject "${form.name}" added`);
      }
      closeModal();
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Save failed');
    } finally { setSaving(false); }
  };

  const handleDelete = async (subject) => {
    if (!confirm(`Delete "${subject.name}"? This cannot be undone.`)) return;
    setDeleting(subject.id);
    try {
      await subjectAPI.delete(subject.id);
      toast.success('Subject deleted');
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Delete failed');
    } finally { setDeleting(null); }
  };

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Subjects</h1>
          <p className={styles.sub}>{subjects.length} subjects configured</p>
        </div>
        <Button icon="+" onClick={openAdd}>Add Subject</Button>
      </div>

      {/* Subject grid */}
      {loading ? (
        <div className={styles.loadState}><div className="spinner" style={{ width: 28, height: 28 }} /></div>
      ) : (
        <div className={styles.grid}>
          {subjects.map(s => (
            <div key={s.id} className={styles.subjectCard}>
              <div className={styles.cardTop}>
                <div className={styles.codeTag}>{s.code}</div>
                <div className={styles.cardActions}>
                  <button className={styles.editBtn} onClick={() => openEdit(s)}>Edit</button>
                  <button
                    className={styles.deleteBtn}
                    onClick={() => handleDelete(s)}
                    disabled={deleting === s.id}
                  >
                    {deleting === s.id ? '...' : 'Delete'}
                  </button>
                </div>
              </div>
              <div className={styles.subjectName}>{s.name}</div>
              {s.description && <div className={styles.subjectDesc}>{s.description}</div>}
              <div className={styles.subjectStats}>
                <span>{s.question_count ?? 0} questions</span>
                <span>·</span>
                <span>{s.exam_count ?? 0} exams</span>
              </div>
            </div>
          ))}

          {/* Add Subject Card */}
          <div className={styles.addCard} onClick={openAdd}>
            <div className={styles.addIcon}>+</div>
            <div className={styles.addLabel}>Add Subject</div>
          </div>
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <div className={styles.overlay} onClick={e => e.target === e.currentTarget && closeModal()}>
          <div className={styles.modal}>
            <div className={styles.modalHeader}>
              <h2 className={styles.modalTitle}>{editTarget ? 'Edit Subject' : 'Add New Subject'}</h2>
              <button className={styles.closeBtn} onClick={closeModal}>✕</button>
            </div>

            <div className={styles.modalBody}>
              <div className={styles.field}>
                <label className={styles.label}>Subject Name</label>
                <input
                  placeholder="e.g. Further Mathematics"
                  value={form.name}
                  onChange={e => handleNameChange(e.target.value)}
                  autoFocus
                />
              </div>

              <div className={styles.field}>
                <label className={styles.label}>
                  Subject Code
                  <span className={styles.labelHint}> · Short unique identifier (max 6 chars)</span>
                </label>
                <input
                  placeholder="e.g. FMT"
                  value={form.code}
                  onChange={e => set('code', e.target.value.toUpperCase().slice(0, 6))}
                  style={{ fontFamily: 'var(--font-mono)', letterSpacing: '0.08em' }}
                />
              </div>

              <div className={styles.field}>
                <label className={styles.label}>Description <span className={styles.labelHint}>(optional)</span></label>
                <textarea
                  placeholder="Brief description of this subject..."
                  value={form.description}
                  onChange={e => set('description', e.target.value)}
                  rows={3}
                />
              </div>

              {/* Preview */}
              {form.name && (
                <div className={styles.preview}>
                  <div className={styles.previewLabel}>Preview</div>
                  <div className={styles.previewCard}>
                    <div className={styles.previewCode}>{form.code || '???'}</div>
                    <div className={styles.previewName}>{form.name}</div>
                  </div>
                </div>
              )}
            </div>

            <div className={styles.modalFooter}>
              <Button variant="ghost" onClick={closeModal}>Cancel</Button>
              <Button onClick={handleSave} loading={saving}>
                {editTarget ? 'Update Subject' : 'Add Subject'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
