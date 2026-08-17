import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import axios from 'axios';

const API = '/api';

function getGrade(pct) {
  if (pct >= 90) return { grade:'A1', color:'#16A34A' };
  if (pct >= 80) return { grade:'B2', color:'#22C55E' };
  if (pct >= 75) return { grade:'B3', color:'#4ADE80' };
  if (pct >= 70) return { grade:'C4', color:'#3B82F6' };
  if (pct >= 65) return { grade:'C5', color:'#60A5FA' };
  if (pct >= 60) return { grade:'C6', color:'#93C5FD' };
  if (pct >= 55) return { grade:'D7', color:'#F59E0B' };
  if (pct >= 50) return { grade:'E8', color:'#FBBF24' };
  return { grade:'F9', color:'#EF4444' };
}

const th = { padding:'10px 14px', textAlign:'left', fontSize:10, fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.07em', borderBottom:'1px solid var(--border)', background:'var(--bg-base)', whiteSpace:'nowrap' };
const td = { padding:'10px 14px', borderTop:'1px solid var(--border)', fontSize:13, verticalAlign:'middle' };

export default function AdminResultsPage() {
  const [classes, setClasses] = useState([]);
  const [selectedClass, setSelectedClass] = useState('');
  const [selectedExam, setSelectedExam] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [search, setSearch] = useState('');

  useEffect(() => { loadClasses(); }, []);
  useEffect(() => { if (selectedClass) loadClassResults(); }, [selectedClass, selectedExam]);

  const loadClasses = async () => {
    try {
      const res = await axios.get(`${API}/results/classes`);
      setClasses(res.data.classes || []);
    } catch { toast.error('Failed to load classes'); }
  };

  const loadClassResults = async () => {
    setLoading(true);
    setData(null);
    try {
      const params = selectedExam ? { exam_id: selectedExam } : {};
      const res = await axios.get(`${API}/results/class/${encodeURIComponent(selectedClass)}`, { params });
      setData(res.data);
    } catch (err) { toast.error(err.response?.data?.error || 'Failed to load results'); }
    finally { setLoading(false); }
  };

  const downloadCSV = async () => {
    setDownloading(true);
    try {
      const params = selectedExam ? `?exam_id=${selectedExam}` : '';
      const res = await axios.get(
        `${API}/results/class/${encodeURIComponent(selectedClass)}/download${params}`,
        { responseType: 'blob' }
      );
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      const safe = selectedClass.replace(/[^a-zA-Z0-9]/g,'_');
      a.href = url;
      a.download = `Results_${safe}_${new Date().toISOString().slice(0,10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('CSV downloaded');
    } catch { toast.error('CSV download failed'); }
    finally { setDownloading(false); }
  };

  const downloadZip = async () => {
    setDownloading(true);
    try {
      const res = await axios.get(
        `${API}/results/class/${encodeURIComponent(selectedClass)}/download-zip`,
        { responseType: 'blob' }
      );
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      const safe = selectedClass.replace(/[^a-zA-Z0-9]/g,'_');
      a.href = url;
      a.download = `Results_${safe}_${new Date().toISOString().slice(0,10)}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('ZIP downloaded — contains CSV for each exam');
    } catch { toast.error('ZIP download failed'); }
    finally { setDownloading(false); }
  };

  const filtered = (data?.results || []).filter(r =>
    !search || r.full_name?.toLowerCase().includes(search.toLowerCase()) ||
    r.reg_number?.includes(search) || r.staff_id?.toLowerCase().includes(search.toLowerCase())
  );

  const cardS = { background:'var(--bg-surface)', border:'1px solid var(--border)', borderRadius:'var(--r-lg)', overflow:'hidden' };
  const btnS = (color='var(--accent)', text='#000') => ({
    display:'inline-flex', alignItems:'center', gap:6,
    padding:'8px 16px', borderRadius:8, border:'none', cursor:'pointer',
    background:color, color:text, fontFamily:'var(--font-body)',
    fontSize:13, fontWeight:700, transition:'all 0.15s',
    opacity: downloading ? 0.6 : 1,
  });
  const statS = { background:'var(--bg-surface)', border:'1px solid var(--border)', borderRadius:'var(--r-lg)', padding:'16px 20px', textAlign:'center' };

  return (
    <div style={{ padding:'28px 32px', maxWidth:1200 }}>

      {/* Header */}
      <div style={{ marginBottom:24 }}>
        <h1 style={{ fontFamily:'var(--font-display)', fontSize:24, fontWeight:800, letterSpacing:'-0.03em', marginBottom:4 }}>
          Class Results
        </h1>
        <p style={{ fontSize:13, color:'var(--text-secondary)' }}>
          View and download student results by class/form
        </p>
      </div>

      {/* Filters */}
      <div style={{ display:'flex', gap:12, marginBottom:20, flexWrap:'wrap', alignItems:'flex-end' }}>
        <div>
          <label style={{ display:'block', fontSize:11, fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:5 }}>
            Select Class / Form
          </label>
          <select
            value={selectedClass}
            onChange={e => { setSelectedClass(e.target.value); setSelectedExam(''); setData(null); setSearch(''); }}
            style={{ padding:'8px 14px', borderRadius:8, border:'1px solid var(--border-md)', background:'var(--bg-raised)', color:'var(--text-primary)', fontFamily:'var(--font-body)', fontSize:14, fontWeight:600, minWidth:200 }}
          >
            <option value="">— Choose a class —</option>
            {classes.map(c => (
              <option key={c.class_name} value={c.class_name}>
                {c.class_name} ({c.student_count} students)
              </option>
            ))}
          </select>
        </div>

        {data?.exams?.length > 0 && (
          <div>
            <label style={{ display:'block', fontSize:11, fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:5 }}>
              Filter by Exam
            </label>
            <select
              value={selectedExam}
              onChange={e => setSelectedExam(e.target.value)}
              style={{ padding:'8px 14px', borderRadius:8, border:'1px solid var(--border-md)', background:'var(--bg-raised)', color:'var(--text-primary)', fontFamily:'var(--font-body)', fontSize:13, minWidth:240 }}
            >
              <option value="">All Exams</option>
              {data.exams.map(e => (
                <option key={e.id} value={e.id}>{e.title}</option>
              ))}
            </select>
          </div>
        )}

        {selectedClass && data && (
          <div style={{ display:'flex', gap:8, marginLeft:'auto', alignItems:'flex-end' }}>
            <button style={btnS('var(--bg-surface)','var(--text-primary)')}
              onClick={downloadCSV} disabled={downloading}
              onMouseOver={e=>e.currentTarget.style.background='var(--bg-overlay)'}
              onMouseOut={e=>e.currentTarget.style.background='var(--bg-surface)'}
            >
              📄 Download CSV
            </button>
            <button style={btnS()}
              onClick={downloadZip} disabled={downloading}
            >
              {downloading ? '⏳ Preparing...' : '📦 Download ZIP (all exams)'}
            </button>
          </div>
        )}
      </div>

      {/* Class summary cards */}
      {!selectedClass && classes.length > 0 && (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(220px,1fr))', gap:14, marginBottom:24 }}>
          {classes.map(c => (
            <div key={c.class_name} style={{ ...cardS, padding:18, cursor:'pointer', transition:'border-color 0.15s' }}
              onClick={() => setSelectedClass(c.class_name)}
              onMouseOver={e=>e.currentTarget.style.borderColor='var(--accent)'}
              onMouseOut={e=>e.currentTarget.style.borderColor='var(--border)'}
            >
              <div style={{ fontFamily:'var(--font-display)', fontSize:18, fontWeight:800, marginBottom:4 }}>{c.class_name}</div>
              <div style={{ fontSize:12, color:'var(--text-secondary)', marginBottom:10 }}>{c.student_count} students</div>
              <div style={{ display:'flex', justifyContent:'space-between', fontSize:12 }}>
                <span style={{ color:'var(--text-muted)' }}>Submitted</span>
                <span style={{ fontWeight:700, color:'var(--accent)' }}>{c.submitted_count || 0}</span>
              </div>
              <div style={{ display:'flex', justifyContent:'space-between', fontSize:12, marginTop:4 }}>
                <span style={{ color:'var(--text-muted)' }}>Avg Score</span>
                <span style={{ fontWeight:700, color: parseFloat(c.avg_percentage||0) >= 50 ? 'var(--green)' : 'var(--red)' }}>
                  {c.avg_percentage ? parseFloat(c.avg_percentage).toFixed(1)+'%' : '—'}
                </span>
              </div>
              <div style={{ marginTop:12, fontSize:11, color:'var(--accent)', fontWeight:600 }}>View Results →</div>
            </div>
          ))}
        </div>
      )}

      {!selectedClass && classes.length === 0 && (
        <div style={{ ...cardS, padding:60, textAlign:'center', color:'var(--text-muted)' }}>
          <div style={{ fontSize:36, marginBottom:12 }}>📊</div>
          <div style={{ fontSize:14, fontWeight:600, marginBottom:6 }}>No classes with results yet</div>
          <div style={{ fontSize:13 }}>Results will appear here once students submit their exams.</div>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div style={{ display:'flex', justifyContent:'center', padding:60 }}>
          <div className="spinner" style={{ width:28, height:28 }} />
        </div>
      )}

      {/* Results for selected class */}
      {data && !loading && (
        <>
          {/* Summary stats */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:14, marginBottom:20 }}>
            {[
              { label:'Total Students', val: data.summary.total_students, color:'var(--blue)' },
              { label:'Submitted', val: data.summary.submitted, color:'var(--accent)' },
              { label:'Passed', val: data.summary.passed, color:'var(--green)' },
              { label:'Failed', val: data.summary.failed, color:'var(--red)' },
              { label:'Avg Score', val: data.summary.avg_percentage+'%', color: parseFloat(data.summary.avg_percentage) >= 50 ? 'var(--green)' : 'var(--red)' },
            ].map(s => (
              <div key={s.label} style={statS}>
                <div style={{ fontSize:11, fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:6 }}>{s.label}</div>
                <div style={{ fontFamily:'var(--font-display)', fontSize:28, fontWeight:800, color:s.color, letterSpacing:'-0.03em' }}>{s.val}</div>
              </div>
            ))}
          </div>

          {/* Search */}
          <div style={{ marginBottom:14 }}>
            <input
              placeholder="Search by name, reg number, staff ID..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ padding:'8px 14px', borderRadius:8, border:'1px solid var(--border-md)', background:'var(--bg-raised)', color:'var(--text-primary)', fontFamily:'var(--font-body)', fontSize:13, width:320 }}
            />
            <span style={{ marginLeft:12, fontSize:12, color:'var(--text-muted)' }}>
              Showing {filtered.length} of {data.results.length} records
            </span>
          </div>

          {/* Results table */}
          <div style={cardS}>
            <table style={{ width:'100%', borderCollapse:'collapse' }}>
              <thead>
                <tr>
                  {['#','Name','Reg No','Staff ID','Exam','Subject','Score','%','Grade','Result','Submitted'].map(h => (
                    <th key={h} style={th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr><td colSpan={11} style={{ ...td, textAlign:'center', padding:40, color:'var(--text-muted)' }}>
                    No results found
                  </td></tr>
                )}
                {filtered.map((r, i) => {
                  const pct = parseFloat(r.percentage || 0);
                  const passThreshold = r.pass_marks && r.exam_total ? (r.pass_marks / r.exam_total) * 100 : 50;
                  const passed = pct >= passThreshold;
                  const isSubmitted = r.session_status === 'submitted';
                  const { grade, color } = getGrade(pct);
                  return (
                    <tr key={i} style={{ background: i%2===0 ? 'transparent' : 'rgba(255,255,255,0.01)' }}>
                      <td style={{ ...td, color:'var(--text-muted)', fontSize:11 }}>{i+1}</td>
                      <td style={td}>
                        <div style={{ fontWeight:600 }}>{r.full_name}</div>
                      </td>
                      <td style={{ ...td, fontFamily:'var(--font-mono)', fontSize:12, color:'var(--accent)' }}>
                        {r.reg_number || '—'}
                      </td>
                      <td style={{ ...td, fontFamily:'var(--font-mono)', fontSize:12, color:'var(--blue)' }}>
                        {r.staff_id || '—'}
                      </td>
                      <td style={{ ...td, maxWidth:180 }}>
                        <div style={{ fontSize:12, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                          {r.exam_title || '—'}
                        </div>
                      </td>
                      <td style={{ ...td, fontSize:12, color:'var(--text-secondary)' }}>{r.subject_name || '—'}</td>
                      <td style={{ ...td, fontFamily:'var(--font-mono)', fontWeight:700 }}>
                        {isSubmitted ? `${r.score}/${r.exam_total}` : '—'}
                      </td>
                      <td style={{ ...td, fontFamily:'var(--font-mono)', fontWeight:700, color: isSubmitted ? (passed ? 'var(--green)' : 'var(--red)') : 'var(--text-muted)' }}>
                        {isSubmitted ? pct.toFixed(1)+'%' : '—'}
                      </td>
                      <td style={td}>
                        {isSubmitted
                          ? <span style={{ fontFamily:'var(--font-display)', fontWeight:800, fontSize:15, color }}>{grade}</span>
                          : <span style={{ color:'var(--text-muted)' }}>—</span>
                        }
                      </td>
                      <td style={td}>
                        {isSubmitted ? (
                          <span style={{
                            display:'inline-block', padding:'2px 10px', borderRadius:20,
                            fontSize:11, fontWeight:700,
                            background: passed ? 'rgba(22,163,74,0.12)' : 'rgba(220,38,38,0.12)',
                            color: passed ? '#16A34A' : '#DC2626',
                          }}>
                            {passed ? '✓ PASSED' : '✗ FAILED'}
                          </span>
                        ) : (
                          <span style={{ fontSize:11, color:'var(--text-muted)', background:'var(--bg-overlay)', padding:'2px 8px', borderRadius:20 }}>
                            {r.session_status || 'not started'}
                          </span>
                        )}
                      </td>
                      <td style={{ ...td, fontSize:11, color:'var(--text-muted)', fontFamily:'var(--font-mono)' }}>
                        {r.submitted_at ? new Date(r.submitted_at).toLocaleString('en-NG',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop:12, fontSize:12, color:'var(--text-muted)' }}>
            ℹ ZIP download contains one CSV file per exam plus a combined CSV with all results.
          </div>
        </>
      )}
    </div>
  );
}
