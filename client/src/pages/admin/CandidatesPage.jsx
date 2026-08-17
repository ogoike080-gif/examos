import React, { useEffect, useState, useRef } from 'react';
import toast from 'react-hot-toast';
import { candidateAPI, examAPI } from '../../utils/api';
import Button from '../../components/shared/Button';

const labelS = { display:'block', fontSize:11, fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:5 };
const inputS = { width:'100%', padding:'8px 12px', borderRadius:8, border:'1px solid var(--border-md)', background:'var(--bg-raised)', color:'var(--text-primary)', fontFamily:'var(--font-body)', fontSize:13, outline:'none' };
const cardS = { background:'var(--bg-surface)', border:'1px solid var(--border)', borderRadius:'var(--r-lg)', overflow:'hidden' };
const thS = { padding:'10px 16px', textAlign:'left', fontSize:10, fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.07em', borderBottom:'1px solid var(--border)', background:'var(--bg-base)' };
const tdS = { padding:'11px 16px', borderTop:'1px solid var(--border)', fontSize:13, verticalAlign:'middle' };

export default function CandidatesPage() {
  const [candidates, setCandidates] = useState([]);
  const [classes, setClasses] = useState([]);
  const [exams, setExams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterClass, setFilterClass] = useState('');
  const [tab, setTab] = useState('list'); // list | register | import | assign
  const [saving, setSaving] = useState(false);
  const fileRef = useRef(null);

  // Register form
  const [form, setForm] = useState({ full_name:'', reg_number:'', class_name:'', staff_id:'' });

  // Import state
  const [csvText, setCsvText] = useState('');
  const [csvClass, setCsvClass] = useState('');
  const [importPreview, setImportPreview] = useState([]);
  const [importing, setImporting] = useState(false);

  // Assign state
  const [assignMode, setAssignMode] = useState('class'); // class | individual
  const [assignClass, setAssignClass] = useState('');
  const [assignExam, setAssignExam] = useState('');
  const [assignCandidate, setAssignCandidate] = useState('');
  const [assigning, setAssigning] = useState(false);

  // Edit modal
  const [editTarget, setEditTarget] = useState(null);
  const [editForm, setEditForm] = useState({ full_name:'', reg_number:'', class_name:'', staff_id:'' });

  // Parent-linking modal
  const [parentTarget, setParentTarget] = useState(null);
  const [linkedParents, setLinkedParents] = useState([]);
  const [parentLoading, setParentLoading] = useState(false);
  const [parentForm, setParentForm] = useState({ email:'', full_name:'', password:'' });
  const [linkingParent, setLinkingParent] = useState(false);

  useEffect(() => { load(); }, [search, filterClass]);

  useEffect(() => {
    examAPI.list().then(r => setExams(r.data.exams || []));
    candidateAPI.classes().then(r => setClasses(r.data.classes || []));
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const params = {};
      if (search) params.search = search;
      if (filterClass) params.class_name = filterClass;
      const res = await candidateAPI.list(params);
      setCandidates(res.data.candidates || []);
    } catch { toast.error('Failed to load candidates'); }
    finally { setLoading(false); }
  };

  const setF = (k, v) => setForm(f => ({ ...f, [k]: v }));

  // ── Register single candidate ──
  const handleRegister = async () => {
    if (!form.full_name.trim()) return toast.error('Full name is required');
    setSaving(true);
    try {
      const res = await candidateAPI.bulkRegister([{
        full_name: form.full_name.trim(),
        reg_number: form.reg_number || undefined,
        class_name: form.class_name || undefined,
        staff_id: form.staff_id || undefined,
        email: form.reg_number ? `${form.reg_number}@ogotech.internal` : form.staff_id ? `${form.staff_id}@ogotech.internal` : undefined,
        password: form.reg_number || form.staff_id || 'Student@2026!',
      }]);
      if (res.data.success > 0) {
        toast.success(`${form.full_name.split(' ')[0]} registered`);
        setForm({ full_name:'', reg_number:'', class_name:'', staff_id:'' });
        load();
        candidateAPI.classes().then(r => setClasses(r.data.classes || []));
      } else {
        toast.error(res.data.errors?.[0]?.error || 'Registration failed');
      }
    } catch (err) { toast.error(err.response?.data?.error || 'Failed'); }
    finally { setSaving(false); }
  };

  // ── CSV import ──
  const handleFileUpload = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
      const text = e.target.result;
      setCsvText(text);
      // Preview first 5 rows
      const lines = text.trim().split(/\r?\n/).slice(0, 6);
      setImportPreview(lines);
    };
    reader.readAsText(file);
  };

  const handleImport = async () => {
    if (!csvText.trim()) return toast.error('No CSV data loaded');
    setImporting(true);
    try {
      const res = await candidateAPI.importCSV(csvText, csvClass);
      toast.success(`${res.data.success} candidates imported`);
      if (res.data.failed > 0) toast(`${res.data.failed} rows failed`, { icon: '⚠' });
      setCsvText(''); setImportPreview([]); setCsvClass('');
      load();
      candidateAPI.classes().then(r => setClasses(r.data.classes || []));
    } catch (err) { toast.error(err.response?.data?.error || 'Import failed'); }
    finally { setImporting(false); }
  };

  // ── Assign to exam ──
  const handleAssign = async () => {
    if (!assignExam) return toast.error('Select an exam first');
    setAssigning(true);
    try {
      if (assignMode === 'class') {
        if (!assignClass) { toast.error('Select a class'); setAssigning(false); return; }
        const res = await candidateAPI.assignClass(assignClass, assignExam);
        toast.success(`${res.data.assigned} candidates assigned from class ${assignClass}`);
        if (res.data.skipped > 0) toast(`${res.data.skipped} already assigned`, { icon: 'ℹ' });
      } else {
        if (!assignCandidate) { toast.error('Select a candidate'); setAssigning(false); return; }
        await candidateAPI.assignExam(assignCandidate, assignExam);
        toast.success('Candidate assigned to exam');
      }
    } catch (err) { toast.error(err.response?.data?.error || 'Assignment failed'); }
    finally { setAssigning(false); }
  };

  // ── Delete candidate ──
  const handleDelete = async (c) => {
    if (!confirm(`Remove "${c.full_name}" from the system? This cannot be undone.`)) return;
    try {
      await candidateAPI.delete(c.id);
      toast.success(`${c.full_name.split(' ')[0]} removed`);
      load();
    } catch (err) { toast.error(err.response?.data?.error || 'Delete failed'); }
  };

  // ── Edit candidate ──
  const openEdit = (c) => {
    setEditTarget(c);
    setEditForm({ full_name: c.full_name, reg_number: c.reg_number||'', class_name: c.class_name||'', staff_id: c.staff_id||'' });
  };

  const handleEdit = async () => {
    if (!editForm.full_name.trim()) return toast.error('Name required');
    try {
      await candidateAPI.update(editTarget.id, editForm);
      toast.success('Candidate updated');
      setEditTarget(null);
      load();
    } catch (err) { toast.error(err.response?.data?.error || 'Update failed'); }
  };

  // ── Parent linking ──
  const openParentModal = async (c) => {
    setParentTarget(c);
    setParentForm({ email:'', full_name:'', password:'' });
    setParentLoading(true);
    try {
      const res = await candidateAPI.listParents(c.id);
      setLinkedParents(res.data.parents || []);
    } catch { toast.error('Failed to load linked parents'); }
    finally { setParentLoading(false); }
  };

  const handleLinkParent = async () => {
    if (!parentForm.email.trim()) return toast.error('Parent email is required');
    setLinkingParent(true);
    try {
      await candidateAPI.linkParent(parentTarget.id, {
        parent_email: parentForm.email.trim(),
        parent_full_name: parentForm.full_name.trim() || undefined,
        parent_password: parentForm.password || undefined,
      });
      toast.success('Parent linked');
      setParentForm({ email:'', full_name:'', password:'' });
      const res = await candidateAPI.listParents(parentTarget.id);
      setLinkedParents(res.data.parents || []);
    } catch (err) { toast.error(err.response?.data?.error || 'Failed to link parent'); }
    finally { setLinkingParent(false); }
  };

  const handleUnlinkParent = async (parentId) => {
    try {
      await candidateAPI.unlinkParent(parentTarget.id, parentId);
      setLinkedParents(ps => ps.filter(p => p.id !== parentId));
      toast.success('Parent unlinked');
    } catch { toast.error('Failed to unlink'); }
  };

  const TabBtn = ({ id, label, icon }) => (
    <button onClick={() => setTab(id)} style={{
      padding:'8px 16px', border:'none', borderRadius:8, cursor:'pointer',
      fontFamily:'var(--font-body)', fontSize:13, fontWeight:600,
      background: tab === id ? 'var(--accent)' : 'var(--bg-raised)',
      color: tab === id ? '#000' : 'var(--text-secondary)',
      transition:'all 0.15s',
    }}>{icon} {label}</button>
  );

  const downloadTemplate = () => {
    const csv = 'full_name,reg_number,class_name\nOkonkwo Chidera James,202300001,SS3A\nAnene Amanda Grace,202300002,SS3A\nUche Emeka Paul,202300003,SS3B';
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'student-import-template.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ padding:'28px 32px' }}>

      {/* Header */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:20 }}>
        <div>
          <h1 style={{ fontFamily:'var(--font-display)', fontSize:24, fontWeight:800, letterSpacing:'-0.03em' }}>Candidates</h1>
          <p style={{ fontSize:13, color:'var(--text-secondary)', marginTop:3 }}>
            {candidates.length} students · Login: Surname only
          </p>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <TabBtn id="list"     label="All Candidates" icon="👥" />
          <TabBtn id="register" label="Register"        icon="+" />
          <TabBtn id="import"   label="Import CSV"      icon="⬆" />
          <TabBtn id="assign"   label="Assign to Exam"  icon="📋" />
        </div>
      </div>

      {/* ── TAB: LIST ── */}
      {tab === 'list' && (
        <>
          <div style={{ display:'flex', gap:8, marginBottom:16 }}>
            <input placeholder="Search name, reg number..." value={search}
              onChange={e => setSearch(e.target.value)} style={{ ...inputS, width:240 }} />
            <select value={filterClass} onChange={e => setFilterClass(e.target.value)} style={{ ...inputS, width:160 }}>
              <option value="">All Classes</option>
              {classes.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            {filterClass && <Button size="sm" variant="ghost" onClick={() => setFilterClass('')}>Clear</Button>}
            <div style={{ marginLeft:'auto', fontSize:13, color:'var(--text-muted)', alignSelf:'center' }}>
              {candidates.length} results
            </div>
          </div>

          <div style={cardS}>
            <table style={{ width:'100%', borderCollapse:'collapse' }}>
              <thead>
                <tr>
                  {['Name','Reg. No.','Staff ID','Class','Exams','Last Login','Actions'].map(h => (
                    <th key={h} style={thS}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading && <tr><td colSpan={6} style={{ ...tdS, textAlign:'center', padding:40 }}><div className="spinner" style={{ width:24, height:24, margin:'0 auto' }} /></td></tr>}
                {!loading && candidates.length === 0 && (
                  <tr><td colSpan={6} style={{ ...tdS, textAlign:'center', padding:40, color:'var(--text-muted)' }}>
                    No candidates found. Use Register or Import CSV to add students.
                  </td></tr>
                )}
                {candidates.map(c => (
                  <tr key={c.id}>
                    <td style={tdS}>
                      <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                        <div style={{ width:30, height:30, borderRadius:'50%', background:'var(--bg-overlay)', display:'flex', alignItems:'center', justifyContent:'center', fontFamily:'var(--font-display)', fontSize:13, fontWeight:700, color:'var(--accent)', flexShrink:0 }}>
                          {c.full_name?.charAt(0)}
                        </div>
                        <div>
                          <div style={{ fontWeight:600 }}>{c.full_name}</div>
                          <div style={{ fontSize:11, color:'var(--text-muted)' }}>Logs in with surname</div>
                        </div>
                      </div>
                    </td>
                    <td style={{ ...tdS, fontFamily:'var(--font-mono)', fontSize:13, fontWeight:700, color:'var(--accent)' }}>
                      {c.reg_number || '—'}
                    </td>
                    <td style={{ ...tdS, fontFamily:'var(--font-mono)', fontSize:12, color:'var(--blue)' }}>
                      {c.staff_id || '—'}
                    </td>
                    <td style={{ ...tdS, color:'var(--text-secondary)' }}>{c.class_name || '—'}</td>
                    <td style={{ ...tdS, fontWeight:600 }}>{c.exam_count || 0}</td>
                    <td style={{ ...tdS, fontFamily:'var(--font-mono)', fontSize:11, color:'var(--text-muted)' }}>
                      {c.last_login ? new Date(c.last_login).toLocaleDateString('en-NG') : 'Never'}
                    </td>
                    <td style={tdS}>
                      <div style={{ display:'flex', gap:5 }}>
                        <Button size="xs" variant="ghost" onClick={() => openEdit(c)}>Edit</Button>
                        <Button size="xs" variant="ghost" onClick={() => openParentModal(c)}>Parent</Button>
                        <Button size="xs" variant="danger" onClick={() => handleDelete(c)}>Delete</Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ── TAB: REGISTER ── */}
      {tab === 'register' && (
        <div style={{ maxWidth:600 }}>
          <div style={{ ...cardS, padding:24 }}>
            <div style={{ fontFamily:'var(--font-display)', fontSize:16, fontWeight:700, marginBottom:20 }}>
              Register New Student
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
              <div>
                <label style={labelS}>Full Name (Surname first)</label>
                <input style={inputS} placeholder="Okonkwo Chidera James"
                  value={form.full_name} onChange={e => setF('full_name', e.target.value)} />
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:14 }}>
                <div>
                  <label style={labelS}>Reg. Number <span style={{ textTransform:'none', fontWeight:500 }}>(optional, 9 digits)</span></label>
                  <input style={{ ...inputS, fontFamily:'var(--font-mono)', letterSpacing:'0.08em', fontSize:15 }}
                    placeholder="202300001" maxLength={9} value={form.reg_number}
                    onChange={e => setF('reg_number', e.target.value.replace(/\D/g,'').slice(0,9))} />
                </div>
                <div>
                  <label style={labelS}>Staff ID <span style={{ textTransform:'none', fontWeight:500 }}>(optional)</span></label>
                  <input style={{ ...inputS, fontFamily:'var(--font-mono)', letterSpacing:'0.06em' }}
                    placeholder="OGT-STAFF-001" value={form.staff_id}
                    onChange={e => setF('staff_id', e.target.value.trim())} />
                </div>
                <div>
                  <label style={labelS}>Class / Form</label>
                  <input style={inputS} placeholder="SS3A" value={form.class_name}
                    onChange={e => setF('class_name', e.target.value)} />
                </div>
              </div>
              <div style={{ padding:'10px 14px', background:'var(--accent-dim)', border:'1px solid rgba(245,166,35,0.2)', borderRadius:8, fontSize:12, color:'var(--text-secondary)' }}>
                💡 Students log in with their <strong>surname</strong> only. Registration number is optional but helps when two students share the same surname.
              </div>
              <Button onClick={handleRegister} loading={saving}>Register Student</Button>
            </div>
          </div>
        </div>
      )}

      {/* ── TAB: IMPORT CSV ── */}
      {tab === 'import' && (
        <div style={{ maxWidth:700 }}>
          <div style={{ ...cardS, padding:24 }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20 }}>
              <div style={{ fontFamily:'var(--font-display)', fontSize:16, fontWeight:700 }}>Import Students from CSV</div>
              <Button variant="ghost" size="sm" onClick={downloadTemplate}>↓ Download Template</Button>
            </div>

            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14, marginBottom:16 }}>
              <div>
                <label style={labelS}>Default Class <span style={{ textTransform:'none', fontWeight:500 }}>(applies to all if CSV has no class column)</span></label>
                <input style={inputS} placeholder="SS3A" value={csvClass}
                  onChange={e => setCsvClass(e.target.value)} />
              </div>
              <div>
                <label style={labelS}>Upload CSV File</label>
                <input ref={fileRef} type="file" accept=".csv,.txt" style={{ display:'none' }}
                  onChange={e => handleFileUpload(e.target.files[0])} />
                <button onClick={() => fileRef.current?.click()} style={{
                  ...inputS, cursor:'pointer', textAlign:'left',
                  color: csvText ? 'var(--green)' : 'var(--text-muted)',
                }}>
                  {csvText ? '✓ File loaded — ready to import' : '📁 Click to choose CSV file'}
                </button>
              </div>
            </div>

            {/* CSV format guide */}
            <div style={{ background:'var(--bg-raised)', border:'1px solid var(--border)', borderRadius:8, padding:14, marginBottom:16 }}>
              <div style={{ fontSize:11, fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:8 }}>CSV Format</div>
              <div style={{ fontFamily:'var(--font-mono)', fontSize:11, color:'var(--text-secondary)', lineHeight:1.8 }}>
                full_name, reg_number, class_name<br/>
                Okonkwo Chidera James, 202300001, SS3A<br/>
                Anene Amanda Grace, 202300002, SS3A<br/>
                <span style={{ color:'var(--text-muted)' }}>(reg_number and class_name are optional)</span>
              </div>
            </div>

            {/* Preview */}
            {importPreview.length > 0 && (
              <div style={{ background:'var(--bg-raised)', border:'1px solid var(--border)', borderRadius:8, padding:14, marginBottom:16 }}>
                <div style={{ fontSize:11, fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:8 }}>Preview (first 5 rows)</div>
                {importPreview.map((row, i) => (
                  <div key={i} style={{ fontFamily:'var(--font-mono)', fontSize:11, color: i===0 ? 'var(--text-muted)' : 'var(--text-secondary)', marginBottom:3, fontWeight: i===0 ? 700 : 400 }}>
                    {row}
                  </div>
                ))}
              </div>
            )}

            <Button onClick={handleImport} loading={importing} disabled={!csvText}>
              Import Students
            </Button>
          </div>
        </div>
      )}

      {/* ── TAB: ASSIGN ── */}
      {tab === 'assign' && (
        <div style={{ maxWidth:600 }}>
          <div style={{ ...cardS, padding:24 }}>
            <div style={{ fontFamily:'var(--font-display)', fontSize:16, fontWeight:700, marginBottom:20 }}>
              Assign Candidates to Exam
            </div>

            {/* Mode switcher */}
            <div style={{ display:'flex', gap:8, marginBottom:20 }}>
              {[['class','By Class (all students in a class)'],['individual','Individual Student']].map(([mode, label]) => (
                <button key={mode} onClick={() => setAssignMode(mode)} style={{
                  flex:1, padding:'9px 12px', border:`1px solid ${assignMode===mode ? 'var(--accent)' : 'var(--border)'}`,
                  borderRadius:8, background: assignMode===mode ? 'var(--accent-dim)' : 'transparent',
                  color: assignMode===mode ? 'var(--accent)' : 'var(--text-secondary)',
                  fontFamily:'var(--font-body)', fontSize:13, fontWeight:600, cursor:'pointer',
                }}>{label}</button>
              ))}
            </div>

            <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
              <div>
                <label style={labelS}>Select Exam</label>
                <select style={inputS} value={assignExam} onChange={e => setAssignExam(e.target.value)}>
                  <option value="">— Choose an exam —</option>
                  {exams.map(ex => (
                    <option key={ex.id} value={ex.id}>{ex.title} ({ex.status})</option>
                  ))}
                </select>
              </div>

              {assignMode === 'class' ? (
                <div>
                  <label style={labelS}>Select Class</label>
                  <select style={inputS} value={assignClass} onChange={e => setAssignClass(e.target.value)}>
                    <option value="">— Choose a class —</option>
                    {classes.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                  {assignClass && (
                    <div style={{ fontSize:12, color:'var(--text-muted)', marginTop:5 }}>
                      All students in class <strong>{assignClass}</strong> will be assigned to the selected exam.
                    </div>
                  )}
                </div>
              ) : (
                <div>
                  <label style={labelS}>Select Student</label>
                  <select style={inputS} value={assignCandidate} onChange={e => setAssignCandidate(e.target.value)}>
                    <option value="">— Choose a student —</option>
                    {candidates.map(c => (
                      <option key={c.id} value={c.id}>{c.full_name} {c.class_name ? `(${c.class_name})` : ''}</option>
                    ))}
                  </select>
                </div>
              )}

              <Button onClick={handleAssign} loading={assigning} disabled={!assignExam}>
                {assignMode === 'class' ? 'Assign Entire Class' : 'Assign Student'} →
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── EDIT MODAL ── */}
      {editTarget && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.6)', backdropFilter:'blur(6px)', zIndex:200, display:'flex', alignItems:'center', justifyContent:'center' }}
          onClick={e => e.target===e.currentTarget && setEditTarget(null)}>
          <div style={{ background:'var(--bg-surface)', border:'1px solid var(--border-md)', borderRadius:'var(--r-xl)', width:440, padding:28, boxShadow:'var(--shadow-lg)' }}>
            <div style={{ fontFamily:'var(--font-display)', fontSize:17, fontWeight:800, marginBottom:20 }}>Edit Candidate</div>
            <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
              <div>
                <label style={labelS}>Full Name</label>
                <input style={inputS} value={editForm.full_name} onChange={e => setEditForm(f=>({...f,full_name:e.target.value}))} />
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:14 }}>
                <div>
                  <label style={labelS}>Reg. Number</label>
                  <input style={{ ...inputS, fontFamily:'var(--font-mono)' }} maxLength={9} value={editForm.reg_number}
                    onChange={e => setEditForm(f=>({...f,reg_number:e.target.value.replace(/\D/g,'').slice(0,9)}))} />
                </div>
                <div>
                  <label style={labelS}>Staff ID</label>
                  <input style={{ ...inputS, fontFamily:'var(--font-mono)' }} value={editForm.staff_id||''}
                    onChange={e => setEditForm(f=>({...f,staff_id:e.target.value.trim()}))} placeholder="OGT-STAFF-001" />
                </div>
                <div>
                  <label style={labelS}>Class</label>
                  <input style={inputS} value={editForm.class_name}
                    onChange={e => setEditForm(f=>({...f,class_name:e.target.value}))} />
                </div>
              </div>
            </div>
            <div style={{ display:'flex', gap:10, justifyContent:'flex-end', marginTop:20 }}>
              <Button variant="ghost" onClick={() => setEditTarget(null)}>Cancel</Button>
              <Button onClick={handleEdit}>Save Changes</Button>
            </div>
          </div>
        </div>
      )}
      {/* ── PARENT LINKING MODAL ── */}
      {parentTarget && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.6)', backdropFilter:'blur(6px)', zIndex:200, display:'flex', alignItems:'center', justifyContent:'center' }}
          onClick={e => e.target===e.currentTarget && setParentTarget(null)}>
          <div style={{ background:'var(--bg-surface)', border:'1px solid var(--border-md)', borderRadius:'var(--r-xl)', width:460, maxHeight:'85vh', overflowY:'auto', padding:28, boxShadow:'var(--shadow-lg)' }}>
            <div style={{ fontFamily:'var(--font-display)', fontSize:17, fontWeight:800, marginBottom:4 }}>Parent Access</div>
            <div style={{ fontSize:12.5, color:'var(--text-muted)', marginBottom:20 }}>for {parentTarget.full_name}</div>

            {parentLoading ? (
              <div style={{ textAlign:'center', padding:20 }}><div className="spinner" style={{ width:22, height:22, margin:'0 auto' }} /></div>
            ) : (
              <>
                {linkedParents.length > 0 && (
                  <div style={{ marginBottom:20 }}>
                    <label style={labelS}>Currently Linked</label>
                    {linkedParents.map(p => (
                      <div key={p.id} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'8px 12px', background:'var(--bg-raised)', borderRadius:8, marginBottom:6 }}>
                        <div>
                          <div style={{ fontSize:13, fontWeight:600 }}>{p.full_name}</div>
                          <div style={{ fontSize:11, color:'var(--text-muted)' }}>{p.email}</div>
                        </div>
                        <Button size="xs" variant="danger" onClick={() => handleUnlinkParent(p.id)}>Unlink</Button>
                      </div>
                    ))}
                  </div>
                )}

                <label style={labelS}>Link {linkedParents.length > 0 ? 'Another' : 'a'} Parent</label>
                <div style={{ display:'flex', flexDirection:'column', gap:10, marginBottom:8 }}>
                  <input style={inputS} placeholder="Parent's email" value={parentForm.email}
                    onChange={e => setParentForm(f => ({ ...f, email:e.target.value }))} />
                  <div style={{ fontSize:11.5, color:'var(--text-muted)' }}>
                    If this email doesn't have an account yet, fill in the fields below to create one:
                  </div>
                  <input style={inputS} placeholder="Parent's full name (new account only)" value={parentForm.full_name}
                    onChange={e => setParentForm(f => ({ ...f, full_name:e.target.value }))} />
                  <input style={inputS} type="password" placeholder="Password for new account (min 6 chars)" value={parentForm.password}
                    onChange={e => setParentForm(f => ({ ...f, password:e.target.value }))} />
                </div>
                <Button onClick={handleLinkParent} loading={linkingParent} style={{ width:'100%' }}>Link Parent</Button>
              </>
            )}

            <div style={{ display:'flex', justifyContent:'flex-end', marginTop:20 }}>
              <Button variant="ghost" onClick={() => setParentTarget(null)}>Close</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
