import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { settingsAPI } from '../../utils/api';
import Button from '../../components/shared/Button';
import styles from './SettingsPage.module.css';

const DEFAULT_GRADING = [
  { min: 90, max: 100, grade: 'A1', remark: 'Excellent' },
  { min: 80, max: 89,  grade: 'B2', remark: 'Very Good' },
  { min: 75, max: 79,  grade: 'B3', remark: 'Good' },
  { min: 70, max: 74,  grade: 'C4', remark: 'Credit' },
  { min: 65, max: 69,  grade: 'C5', remark: 'Credit' },
  { min: 60, max: 64,  grade: 'C6', remark: 'Credit' },
  { min: 55, max: 59,  grade: 'D7', remark: 'Pass' },
  { min: 50, max: 54,  grade: 'E8', remark: 'Pass' },
  { min: 0,  max: 49,  grade: 'F9', remark: 'Fail' },
];

export default function SettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState('school');
  const [form, setForm] = useState({
    school_name: 'Ogotech Conventional/Technical School',
    school_short_name: 'Ogotech',
    school_motto: 'Excellence Through Knowledge and Skills',
    school_address: 'Delta State, Nigeria',
    school_phone: '+234-800-000-0000',
    school_email: 'info@ogotech.edu.ng',
    school_website: '',
    school_logo_url: '',
    result_footer: 'This result is computer-generated and valid without signature.',
    result_color: '#1A6BFF',
    result_show_position: false,
    result_show_class: true,
    result_show_teacher_comment: true,
    result_grading_system: DEFAULT_GRADING,
    principal_name: '',
    principal_title: 'Principal',
    exam_officer_name: '',
    stamp_text: 'OFFICIAL RESULT',
  });

  useEffect(() => { load(); }, []);

  const load = async () => {
    try {
      const res = await settingsAPI.get();
      const s = res.data.settings;
      if (s) {
        setForm(f => ({
          ...f,
          ...s,
          result_grading_system: Array.isArray(s.result_grading_system)
            ? s.result_grading_system
            : DEFAULT_GRADING,
        }));
      }
    } catch { /* use defaults */ }
    finally { setLoading(false); }
  };

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }));

  const setGrade = (idx, key, val) => {
    const grading = [...form.result_grading_system];
    grading[idx] = { ...grading[idx], [key]: key === 'min' || key === 'max' ? Number(val) : val };
    set('result_grading_system', grading);
  };

  const handleSave = async () => {
    if (!form.school_name.trim()) return toast.error('School name is required');
    setSaving(true);
    try {
      await settingsAPI.update(form);
      toast.success('Settings saved successfully ✓');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Save failed');
    } finally { setSaving(false); }
  };

  const TABS = [
    { id: 'school', label: 'School Info' },
    { id: 'result', label: 'Result Slip' },
    { id: 'grading', label: 'Grading System' },
    { id: 'staff', label: 'Staff & Signatures' },
  ];

  const F = ({ label, hint, children }) => (
    <div className={styles.field}>
      <label className={styles.label}>
        {label}
        {hint && <span className={styles.hint}> · {hint}</span>}
      </label>
      {children}
    </div>
  );

  const Grid = ({ children }) => <div className={styles.grid2}>{children}</div>;

  if (loading) return (
    <div className={styles.loadState}><div className="spinner" style={{ width: 28, height: 28 }} /></div>
  );

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>School Settings</h1>
          <p className={styles.sub}>Configure branding, result slip appearance, and grading system</p>
        </div>
        <Button onClick={handleSave} loading={saving}>Save All Settings</Button>
      </div>

      {/* School name preview banner */}
      <div className={styles.previewBanner} style={{ borderColor: form.result_color }}>
        <div className={styles.previewBannerLeft} style={{ background: form.result_color }}>
          {form.school_logo_url
            ? <img src={form.school_logo_url} alt="logo" className={styles.previewLogo} />
            : <div className={styles.previewLogoPlaceholder}>{form.school_short_name?.charAt(0) || 'S'}</div>
          }
        </div>
        <div className={styles.previewBannerInfo}>
          <div className={styles.previewSchoolName}>{form.school_name}</div>
          <div className={styles.previewMotto}>{form.school_motto}</div>
          <div className={styles.previewAddress}>{form.school_address}</div>
        </div>
        <div className={styles.previewBannerRight}>
          <div className={styles.previewStamp} style={{ borderColor: form.result_color, color: form.result_color }}>
            {form.stamp_text}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className={styles.tabs}>
        {TABS.map(t => (
          <button
            key={t.id}
            className={`${styles.tab} ${tab === t.id ? styles.tabActive : ''}`}
            onClick={() => setTab(t.id)}
            style={tab === t.id ? { color: form.result_color, borderColor: form.result_color } : {}}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className={styles.tabContent}>

        {/* ── SCHOOL INFO ── */}
        {tab === 'school' && (
          <div className={styles.section}>
            <F label="Full School Name" hint="Appears on result slip header">
              <input
                value={form.school_name}
                onChange={e => set('school_name', e.target.value)}
                placeholder="Ogotech Conventional/Technical School"
                style={{ fontSize: 15, fontWeight: 600 }}
              />
            </F>
            <Grid>
              <F label="Short Name / Abbreviation">
                <input value={form.school_short_name} onChange={e => set('school_short_name', e.target.value)} placeholder="Ogotech" />
              </F>
              <F label="School Motto">
                <input value={form.school_motto} onChange={e => set('school_motto', e.target.value)} placeholder="Excellence Through Knowledge..." />
              </F>
            </Grid>
            <F label="School Address">
              <textarea rows={2} value={form.school_address} onChange={e => set('school_address', e.target.value)} placeholder="Full address, city, state, country" />
            </F>
            <Grid>
              <F label="Phone Number">
                <input value={form.school_phone} onChange={e => set('school_phone', e.target.value)} placeholder="+234-800-000-0000" />
              </F>
              <F label="Email Address">
                <input type="email" value={form.school_email} onChange={e => set('school_email', e.target.value)} placeholder="info@school.edu.ng" />
              </F>
            </Grid>
            <Grid>
              <F label="Website" hint="optional">
                <input value={form.school_website} onChange={e => set('school_website', e.target.value)} placeholder="https://ogotech.edu.ng" />
              </F>
              <F label="School Logo URL" hint="Paste a direct image link">
                <input value={form.school_logo_url} onChange={e => set('school_logo_url', e.target.value)} placeholder="https://..." />
              </F>
            </Grid>
          </div>
        )}

        {/* ── RESULT SLIP ── */}
        {tab === 'result' && (
          <div className={styles.section}>
            <Grid>
              <F label="Result Theme Colour">
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <input type="color" value={form.result_color} onChange={e => set('result_color', e.target.value)}
                    style={{ width: 48, height: 38, padding: 2, border: '1px solid var(--border-md)', borderRadius: 8, cursor: 'pointer' }} />
                  <input value={form.result_color} onChange={e => set('result_color', e.target.value)}
                    style={{ flex: 1, fontFamily: 'var(--font-mono)' }} placeholder="#1A6BFF" />
                  <div style={{ display: 'flex', gap: 6 }}>
                    {['#1A6BFF','#16A34A','#DC2626','#7C3AED','#D97706','#0891B2'].map(c => (
                      <div key={c} onClick={() => set('result_color', c)}
                        style={{ width: 24, height: 24, borderRadius: '50%', background: c, cursor: 'pointer', border: form.result_color === c ? '2px solid white' : '2px solid transparent', outline: '2px solid ' + c }} />
                    ))}
                  </div>
                </div>
              </F>
              <F label="Stamp / Watermark Text">
                <input value={form.stamp_text} onChange={e => set('stamp_text', e.target.value)} placeholder="OFFICIAL RESULT" />
              </F>
            </Grid>

            <F label="Result Slip Footer Note">
              <textarea rows={2} value={form.result_footer} onChange={e => set('result_footer', e.target.value)}
                placeholder="This result is computer-generated and valid without signature." />
            </F>

            <div className={styles.toggleGroup}>
              <div className={styles.toggleGroupTitle}>Show on Result Slip</div>
              {[
                ['result_show_position', 'Class position / ranking'],
                ['result_show_class', 'Class / form'],
                ['result_show_teacher_comment', "Teacher's comment"],
              ].map(([key, label]) => (
                <label key={key} className={styles.toggle}>
                  <div className={styles.toggleTrack} onClick={() => set(key, !form[key])}
                    style={{ background: form[key] ? form.result_color : 'var(--bg-overlay)' }}>
                    <div className={`${styles.toggleThumb} ${form[key] ? styles.toggleThumbOn : ''}`} />
                  </div>
                  <span className={styles.toggleLabel}>{label}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        {/* ── GRADING SYSTEM ── */}
        {tab === 'grading' && (
          <div className={styles.section}>
            <div className={styles.gradingNote}>
              This grading scale appears on the result slip and determines each student's grade letter and remark.
            </div>
            <div className={styles.gradingTable}>
              <div className={styles.gradingHeader}>
                <span>Min Score (%)</span>
                <span>Max Score (%)</span>
                <span>Grade</span>
                <span>Remark</span>
                <span>Preview</span>
              </div>
              {form.result_grading_system.map((row, i) => (
                <div key={i} className={styles.gradingRow}>
                  <input type="number" min={0} max={100} value={row.min} onChange={e => setGrade(i, 'min', e.target.value)} />
                  <input type="number" min={0} max={100} value={row.max} onChange={e => setGrade(i, 'max', e.target.value)} />
                  <input value={row.grade} onChange={e => setGrade(i, 'grade', e.target.value)} style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, textAlign: 'center' }} />
                  <input value={row.remark} onChange={e => setGrade(i, 'remark', e.target.value)} />
                  <span className={styles.gradingPreview}
                    style={{ color: row.remark === 'Fail' ? 'var(--red)' : row.remark === 'Pass' ? 'var(--amber)' : 'var(--green)' }}>
                    {row.min}–{row.max}% → <strong>{row.grade}</strong> ({row.remark})
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── STAFF ── */}
        {tab === 'staff' && (
          <div className={styles.section}>
            <Grid>
              <F label="Principal / Head Teacher Name">
                <input value={form.principal_name} onChange={e => set('principal_name', e.target.value)} placeholder="Mr. Efevawere Onowotu" />
              </F>
              <F label="Principal Title">
                <input value={form.principal_title} onChange={e => set('principal_title', e.target.value)} placeholder="Principal" />
              </F>
            </Grid>
            <F label="Exam Officer Name" hint="Appears on result slip">
              <input value={form.exam_officer_name} onChange={e => set('exam_officer_name', e.target.value)} placeholder="Mrs. Adaeze Obi" />
            </F>
            <div className={styles.signatureNote}>
              Signatures are shown as blank lines on the printed result slip with the name below.
              Upload a scanned signature image URL if you want a real signature to appear.
            </div>
          </div>
        )}

      </div>

      <div className={styles.saveBar}>
        <Button onClick={handleSave} loading={saving} size="lg">
          Save All Settings
        </Button>
        <span className={styles.saveSub}>Changes apply immediately to all new result slips</span>
      </div>
    </div>
  );
}
