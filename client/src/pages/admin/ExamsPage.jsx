import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { examAPI, questionAPI } from '../../utils/api';
import Button from '../../components/shared/Button';

const STATUS_COLORS = {
  draft: 'tag-gray', scheduled: 'tag-blue', active: 'tag-green',
  paused: 'tag-amber', completed: 'tag-gray', archived: 'tag-gray',
};

export default function ExamsPage() {
  const navigate = useNavigate();
  const [exams, setExams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editModal, setEditModal] = useState(null); // exam object being edited
  const [saving, setSaving] = useState(false);
  const [yearInput, setYearInput] = useState('');
  const [deletingYear, setDeletingYear] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [editForm, setEditForm] = useState({
    scheduled_at: '', duration_minutes: '', status: '',
    title: '', pass_marks: '', total_marks: '',
  });

  useEffect(() => { load(); }, []);

  const load = async () => {
    setLoading(true);
    try {
      const res = await examAPI.list();
      setExams(res.data.exams || []);
    } catch { toast.error('Failed to load exams'); }
    finally { setLoading(false); }
  };

  const openEdit = (exam) => {
    setEditForm({
      title: exam.title || '',
      scheduled_at: exam.scheduled_at
        ? new Date(exam.scheduled_at).toISOString().slice(0, 16)
        : '',
      duration_minutes: exam.duration_minutes || 60,
      status: exam.status || 'scheduled',
      pass_marks: exam.pass_marks || '',
      total_marks: exam.total_marks || '',
    });
    setEditModal(exam);
  };

  const handleSave = async () => {
    if (!editForm.title.trim()) return toast.error('Title required');
    setSaving(true);
    try {
      await examAPI.update(editModal.id, {
        ...editForm,
        duration_minutes: Number(editForm.duration_minutes),
        pass_marks: Number(editForm.pass_marks),
        total_marks: Number(editForm.total_marks),
        scheduled_at: editForm.scheduled_at || null,
        settings: JSON.parse(editModal.settings || '{}'),
      });
      toast.success('Exam updated successfully');
      setEditModal(null);
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Update failed');
    } finally { setSaving(false); }
  };

  const changeStatus = async (id, status) => {
    try {
      await examAPI.update(id, { status });
      toast.success(`Exam ${status}`);
      load();
    } catch { toast.error('Update failed'); }
  };

  const deleteExam = async (exam) => {
    if (!confirm(`Delete "${exam.title}"? This cannot be undone.`)) return;
    setDeletingId(exam.id);
    try {
      await examAPI.delete(exam.id);
      toast.success('Exam deleted');
      load();
    } catch (err) {
      const msg = err.response?.data?.error || 'Delete failed';
      // 409 = candidates have already taken this exam; offer to force it
      if (err.response?.status === 409 && confirm(`${msg}\n\nDelete anyway, including their results?`)) {
        try {
          await examAPI.delete(exam.id, true);
          toast.success('Exam and its results deleted');
          load();
        } catch { toast.error('Delete failed'); }
      } else {
        toast.error(msg);
      }
    } finally { setDeletingId(null); }
  };

  const deleteByYear = async () => {
    const year = yearInput.trim();
    if (!/^\d{4}$/.test(year)) return toast.error('Enter a 4-digit year, e.g. 1993');
    if (!confirm(`Delete every exam with "${year}" in its title?`)) return;
    setDeletingYear(true);
    try {
      const res = await examAPI.deleteByYear(year);
      const { deleted, blocked, message } = res.data;
      if (blocked?.length && confirm(`${message}\n\nDelete those ${blocked.length} too anyway, including their results?`)) {
        const forced = await examAPI.deleteByYear(year, true);
        toast.success(forced.data.message);
      } else {
        toast.success(message || `Deleted ${deleted} exam(s)`);
      }
      setYearInput('');
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Delete failed');
    } finally { setDeletingYear(false); }
  };

  const card = {
    background: 'var(--bg-surface)', border: '1px solid var(--border)',
    borderRadius: 'var(--r-lg)', overflow: 'hidden',
  };
  const th = {
    padding: '10px 16px', textAlign: 'left', fontSize: 10,
    fontWeight: 700, color: 'var(--text-muted)',
    textTransform: 'uppercase', letterSpacing: '0.07em',
    borderBottom: '1px solid var(--border)', background: 'var(--bg-base)',
  };
  const td = { padding: '12px 16px', borderTop: '1px solid var(--border)', fontSize: 13, verticalAlign: 'middle' };

  return (
    <div style={{ padding: '28px 32px' }}>

      {/* Header */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom: 24, gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontFamily:'var(--font-display)', fontSize:24, fontWeight:800, letterSpacing:'-0.03em' }}>Exams</h1>
          <p style={{ fontSize:13, color:'var(--text-secondary)', marginTop:3 }}>{exams.length} total exams</p>
        </div>
        <div style={{ display:'flex', gap:10, alignItems:'center', flexWrap:'wrap' }}>
          <div style={{ display:'flex', alignItems:'center', gap:6 }}>
            <input
              value={yearInput}
              onChange={e => setYearInput(e.target.value.replace(/[^0-9]/g, '').slice(0,4))}
              placeholder="Year e.g. 1993"
              style={{ width: 130 }}
            />
            <Button size="sm" variant="danger" onClick={deleteByYear} loading={deletingYear} disabled={!yearInput.trim()}>
              Delete by Year
            </Button>
          </div>
          <Button onClick={() => navigate('/admin/exams/new')}>+ Create Exam</Button>
        </div>
      </div>

      {loading ? (
        <div style={{ display:'flex', justifyContent:'center', padding:60 }}>
          <div className="spinner" style={{ width:28, height:28 }} />
        </div>
      ) : (
        <div style={card}>
          <table style={{ width:'100%', borderCollapse:'collapse' }}>
            <thead>
              <tr>
                {['Exam Title','Subject','Duration','Scheduled At','Candidates','Status','Actions'].map(h => (
                  <th key={h} style={th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {exams.length === 0 && (
                <tr><td colSpan={7} style={{ padding:40, textAlign:'center', color:'var(--text-muted)', fontSize:13 }}>
                  No exams yet.{' '}
                  <span onClick={() => navigate('/admin/exams/new')} style={{ color:'var(--accent)', cursor:'pointer' }}>
                    Create one →
                  </span>
                </td></tr>
              )}
              {exams.map(exam => (
                <tr key={exam.id}>
                  <td style={td}>
                    <div style={{ fontWeight:600 }}>{exam.title}</div>
                    <div style={{ fontSize:11, color:'var(--text-muted)', marginTop:2 }}>{exam.exam_type || 'General'}</div>
                  </td>
                  <td style={{ ...td, color:'var(--text-secondary)' }}>{exam.subject_name || '—'}</td>
                  <td style={{ ...td, fontFamily:'var(--font-mono)', fontSize:12 }}>{exam.duration_minutes} min</td>
                  <td style={{ ...td, fontFamily:'var(--font-mono)', fontSize:11, color:'var(--text-secondary)' }}>
                    {exam.scheduled_at
                      ? new Date(exam.scheduled_at).toLocaleString('en-NG', {
                          day:'2-digit', month:'short', year:'numeric',
                          hour:'2-digit', minute:'2-digit',
                        })
                      : '—'}
                  </td>
                  <td style={{ ...td, fontWeight:600 }}>{exam.candidate_count || 0}</td>
                  <td style={td}>
                    <span className={`tag ${STATUS_COLORS[exam.status] || 'tag-gray'}`}>
                      {exam.status}
                    </span>
                  </td>
                  <td style={td}>
                    <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
                      {/* Edit time / details */}
                      <Button size="xs" variant="ghost" onClick={() => openEdit(exam)}>
                        ✎ Edit
                      </Button>
                      {/* Status controls */}
                      {exam.status === 'draft' && (
                        <Button size="xs" onClick={() => changeStatus(exam.id, 'scheduled')}>Schedule</Button>
                      )}
                      {exam.status === 'scheduled' && (
                        <Button size="xs" onClick={() => changeStatus(exam.id, 'active')}>Launch Now</Button>
                      )}
                      {exam.status === 'active' && (
                        <Button size="xs" variant="ghost" onClick={() => changeStatus(exam.id, 'paused')}>Pause</Button>
                      )}
                      {exam.status === 'paused' && (
                        <Button size="xs" variant="success" onClick={() => changeStatus(exam.id, 'active')}>Resume</Button>
                      )}
                      {['active','paused'].includes(exam.status) && (
                        <Button size="xs" variant="danger" onClick={() => {
                          if (confirm('End this exam for all candidates?')) changeStatus(exam.id, 'completed');
                        }}>End</Button>
                      )}
                      <Button size="xs" variant="danger" onClick={() => deleteExam(exam)} loading={deletingId === exam.id}>
                        🗑 Delete
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── EDIT MODAL ── */}
      {editModal && (
        <div style={{
          position:'fixed', inset:0, background:'rgba(0,0,0,0.65)',
          backdropFilter:'blur(6px)', zIndex:200,
          display:'flex', alignItems:'center', justifyContent:'center',
        }}
          onClick={e => e.target === e.currentTarget && setEditModal(null)}
        >
          <div style={{
            background:'var(--bg-surface)', border:'1px solid var(--border-md)',
            borderRadius:'var(--r-xl)', width:520, maxWidth:'95vw',
            boxShadow:'var(--shadow-lg)', overflow:'hidden',
          }}>
            {/* Modal header */}
            <div style={{
              padding:'18px 24px', borderBottom:'1px solid var(--border)',
              display:'flex', alignItems:'center', justifyContent:'space-between',
            }}>
              <div style={{ fontFamily:'var(--font-display)', fontSize:17, fontWeight:800 }}>
                Edit Exam
              </div>
              <button onClick={() => setEditModal(null)} style={{
                background:'var(--bg-raised)', border:'1px solid var(--border)',
                color:'var(--text-secondary)', width:28, height:28, borderRadius:8,
                cursor:'pointer', fontSize:12, display:'flex', alignItems:'center', justifyContent:'center',
              }}>✕</button>
            </div>

            {/* Modal body */}
            <div style={{ padding:'20px 24px', display:'flex', flexDirection:'column', gap:14 }}>

              <div>
                <label style={{ display:'block', fontSize:11, fontWeight:700, color:'var(--text-secondary)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:5 }}>
                  Exam Title
                </label>
                <input
                  value={editForm.title}
                  onChange={e => setEditForm(f => ({ ...f, title: e.target.value }))}
                  placeholder="Exam title"
                />
              </div>

              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
                <div>
                  <label style={{ display:'block', fontSize:11, fontWeight:700, color:'var(--text-secondary)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:5 }}>
                    Scheduled Date & Time
                  </label>
                  <input
                    type="datetime-local"
                    value={editForm.scheduled_at}
                    onChange={e => setEditForm(f => ({ ...f, scheduled_at: e.target.value }))}
                  />
                  <div style={{ fontSize:11, color:'var(--text-muted)', marginTop:4 }}>
                    Students can login at this exact time
                  </div>
                </div>
                <div>
                  <label style={{ display:'block', fontSize:11, fontWeight:700, color:'var(--text-secondary)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:5 }}>
                    Duration (minutes)
                  </label>
                  <input
                    type="number" min={5} max={360}
                    value={editForm.duration_minutes}
                    onChange={e => setEditForm(f => ({ ...f, duration_minutes: e.target.value }))}
                  />
                </div>
              </div>

              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:14 }}>
                <div>
                  <label style={{ display:'block', fontSize:11, fontWeight:700, color:'var(--text-secondary)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:5 }}>
                    Total Marks
                  </label>
                  <input
                    type="number"
                    value={editForm.total_marks}
                    onChange={e => setEditForm(f => ({ ...f, total_marks: e.target.value }))}
                  />
                </div>
                <div>
                  <label style={{ display:'block', fontSize:11, fontWeight:700, color:'var(--text-secondary)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:5 }}>
                    Pass Mark
                  </label>
                  <input
                    type="number"
                    value={editForm.pass_marks}
                    onChange={e => setEditForm(f => ({ ...f, pass_marks: e.target.value }))}
                  />
                </div>
                <div>
                  <label style={{ display:'block', fontSize:11, fontWeight:700, color:'var(--text-secondary)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:5 }}>
                    Status
                  </label>
                  <select value={editForm.status} onChange={e => setEditForm(f => ({ ...f, status: e.target.value }))}>
                    <option value="draft">Draft</option>
                    <option value="scheduled">Scheduled</option>
                    <option value="active">Active</option>
                    <option value="paused">Paused</option>
                    <option value="completed">Completed</option>
                  </select>
                </div>
              </div>

              <div style={{
                padding:'10px 14px', background:'var(--accent-dim)',
                border:'1px solid rgba(245,166,35,0.2)', borderRadius:'var(--r)',
                fontSize:12, color:'var(--text-secondary)', lineHeight:1.6,
              }}>
                💡 Changing the <strong>Scheduled Date & Time</strong> automatically updates when students can access this exam.
                Students will see it open at the new time.
              </div>
            </div>

            {/* Modal footer */}
            <div style={{
              padding:'14px 24px', borderTop:'1px solid var(--border)',
              display:'flex', gap:10, justifyContent:'flex-end',
            }}>
              <Button variant="ghost" onClick={() => setEditModal(null)}>Cancel</Button>
              <Button onClick={handleSave} loading={saving}>Save Changes</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
