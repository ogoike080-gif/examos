import React, { useRef } from 'react';

export function Certificate({ candidate, exam, score, percentage, grade, date, schoolName, principalName, examOfficer, certId }) {
  const ref = useRef();

  const passed = parseFloat(percentage) >= 50;
  const gradeColor = parseFloat(percentage) >= 70 ? '#16A34A' : parseFloat(percentage) >= 50 ? '#2563EB' : '#DC2626';

  const print = () => {
    const win = window.open('', '_blank');
    win.document.write(`
      <html><head><title>Certificate - ${candidate}</title>
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@700;800;900&family=Inter:wght@400;500;600;700&display=swap');
        * { margin:0; padding:0; box-sizing:border-box; }
        body { background:#fff; }
        @media print { @page { size: A4 landscape; margin: 0; } }
      </style></head>
      <body>${ref.current.outerHTML}</body></html>
    `);
    win.document.close();
    setTimeout(() => { win.print(); }, 500);
  };

  return (
    <div>
      {/* Print button */}
      <div style={{ display:'flex', justifyContent:'flex-end', marginBottom:16, gap:10 }}>
        <button className="btn btn-secondary btn-sm" onClick={() => window.history.back()}>← Back</button>
        <button className="btn btn-primary" onClick={print}>🖨 Print Certificate</button>
      </div>

      {/* Certificate */}
      <div ref={ref} style={{
        width: '100%', maxWidth: 900,
        margin: '0 auto',
        aspectRatio: '1.414 / 1',
        background: '#fff',
        borderRadius: 16,
        position: 'relative',
        overflow: 'hidden',
        fontFamily: "'Inter', sans-serif",
        boxShadow: '0 20px 60px rgba(0,0,0,0.15)',
        border: '1px solid #e5e7eb',
      }}>

        {/* Outer decorative border */}
        <div style={{ position:'absolute', inset:12, border:'3px solid #6366F1', borderRadius:10, pointerEvents:'none', zIndex:1 }}/>
        <div style={{ position:'absolute', inset:16, border:'1px solid rgba(99,102,241,0.3)', borderRadius:8, pointerEvents:'none', zIndex:1 }}/>

        {/* Background pattern */}
        <div style={{ position:'absolute', inset:0, background:'radial-gradient(ellipse at 20% 50%, rgba(99,102,241,0.04) 0%, transparent 60%), radial-gradient(ellipse at 80% 50%, rgba(167,139,250,0.04) 0%, transparent 60%)', pointerEvents:'none' }}/>

        {/* Gold corner ornaments */}
        {[
          { top:20, left:20, transform:'none' },
          { top:20, right:20, transform:'scaleX(-1)' },
          { bottom:20, left:20, transform:'scaleY(-1)' },
          { bottom:20, right:20, transform:'scale(-1,-1)' },
        ].map((pos, i) => (
          <div key={i} style={{ position:'absolute', ...pos, width:40, height:40, pointerEvents:'none', zIndex:2 }}>
            <svg viewBox="0 0 40 40" style={{ width:'100%', height:'100%' }}>
              <path d="M2,2 L18,2 L2,18 Z" fill="#6366F1" opacity="0.6"/>
              <path d="M2,2 L8,2 L2,8 Z" fill="#6366F1"/>
            </svg>
          </div>
        ))}

        {/* Content */}
        <div style={{ position:'relative', zIndex:3, height:'100%', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:'40px 60px', textAlign:'center' }}>

          {/* School name */}
          <div style={{ fontSize:11, fontWeight:700, letterSpacing:'0.2em', color:'#6366F1', textTransform:'uppercase', marginBottom:6 }}>
            {schoolName || 'Ogotech Conventional/Technical School'}
          </div>

          {/* Title */}
          <div style={{ fontFamily:"'Syne', sans-serif", fontSize:11, fontWeight:700, color:'#9CA3AF', letterSpacing:'0.15em', textTransform:'uppercase', marginBottom:12 }}>
            Certificate of Achievement
          </div>

          {/* Decorative line */}
          <div style={{ display:'flex', alignItems:'center', gap:12, width:'60%', marginBottom:16 }}>
            <div style={{ flex:1, height:1, background:'linear-gradient(90deg, transparent, #6366F1)' }}/>
            <div style={{ fontSize:18 }}>⭐</div>
            <div style={{ flex:1, height:1, background:'linear-gradient(90deg, #6366F1, transparent)' }}/>
          </div>

          {/* "This is to certify" */}
          <div style={{ fontSize:12, color:'#6B7280', marginBottom:6, fontStyle:'italic' }}>This is to certify that</div>

          {/* Candidate name */}
          <div style={{ fontFamily:"'Syne', sans-serif", fontSize:32, fontWeight:900, color:'#1F2937', letterSpacing:'-0.02em', marginBottom:4, lineHeight:1.1 }}>
            {candidate}
          </div>

          <div style={{ fontSize:11, color:'#9CA3AF', marginBottom:16, letterSpacing:'0.1em', textTransform:'uppercase' }}>has successfully completed</div>

          {/* Exam name */}
          <div style={{ fontSize:18, fontWeight:700, color:'#111827', marginBottom:6, maxWidth:500 }}>{exam}</div>

          {/* Score */}
          <div style={{ display:'flex', alignItems:'center', gap:24, marginBottom:16 }}>
            <div style={{ textAlign:'center' }}>
              <div style={{ fontFamily:"'Syne', sans-serif", fontSize:28, fontWeight:900, color:gradeColor, lineHeight:1 }}>{grade}</div>
              <div style={{ fontSize:9, color:'#9CA3AF', textTransform:'uppercase', letterSpacing:'0.08em', marginTop:2 }}>Grade</div>
            </div>
            <div style={{ width:1, height:40, background:'#E5E7EB' }}/>
            <div style={{ textAlign:'center' }}>
              <div style={{ fontFamily:"'Syne', sans-serif", fontSize:28, fontWeight:900, color:gradeColor, lineHeight:1 }}>{parseFloat(percentage).toFixed(1)}%</div>
              <div style={{ fontSize:9, color:'#9CA3AF', textTransform:'uppercase', letterSpacing:'0.08em', marginTop:2 }}>Score</div>
            </div>
            <div style={{ width:1, height:40, background:'#E5E7EB' }}/>
            <div style={{ textAlign:'center' }}>
              <div style={{ fontFamily:"'Syne', sans-serif", fontSize:18, fontWeight:900, color: passed ? '#16A34A' : '#DC2626', lineHeight:1 }}>{passed ? 'PASSED' : 'FAILED'}</div>
              <div style={{ fontSize:9, color:'#9CA3AF', textTransform:'uppercase', letterSpacing:'0.08em', marginTop:2 }}>Result</div>
            </div>
          </div>

          {/* Date */}
          <div style={{ fontSize:11, color:'#9CA3AF', marginBottom:20 }}>
            Awarded on {date || new Date().toLocaleDateString('en-NG', { day:'numeric', month:'long', year:'numeric' })}
          </div>

          {/* Signatures */}
          <div style={{ display:'flex', justifyContent:'space-between', width:'80%', marginBottom:8 }}>
            {[['Principal', principalName], ['Official Seal', null], ['Exam Officer', examOfficer]].map(([title, name], i) => (
              <div key={i} style={{ textAlign:'center', minWidth:140 }}>
                {i === 1 ? (
                  <div style={{ width:56, height:56, borderRadius:'50%', border:'2px solid #6366F1', margin:'0 auto 6px', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', color:'#6366F1' }}>
                    <div style={{ fontSize:8, fontWeight:700, letterSpacing:'0.05em' }}>OFFICIAL</div>
                    <div style={{ fontSize:8, fontWeight:700 }}>SEAL</div>
                  </div>
                ) : (
                  <div style={{ borderBottom:'1px solid #374151', marginBottom:6, height:32 }}/>
                )}
                <div style={{ fontSize:10, fontWeight:700, color:'#374151' }}>{name || '_______________'}</div>
                <div style={{ fontSize:9, color:'#9CA3AF', marginTop:2 }}>{title}</div>
              </div>
            ))}
          </div>

          {/* Certificate ID */}
          <div style={{ fontSize:8, color:'#D1D5DB', fontFamily:'monospace', letterSpacing:'0.1em' }}>
            CERT ID: {certId || 'EXAMOS-' + Date.now().toString(36).toUpperCase()}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Certificate page — loads result and renders cert ─────────
import { useParams, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { examAPI, settingsAPI } from '../../utils/api';

export function CertificatePage() {
  const { sessionId } = useParams();
  const [data, setData] = useState(null);
  const [settings, setSettings] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      examAPI.results(sessionId),
      settingsAPI.get().catch(() => ({ data:{ settings:{} } })),
    ]).then(([r, s]) => {
      setData(r.data.result);
      setSettings(s.data.settings || {});
    }).finally(() => setLoading(false));
  }, [sessionId]);

  if (loading) return (
    <div style={{ minHeight:'100dvh', display:'flex', alignItems:'center', justifyContent:'center' }}>
      <div className="spinner" style={{ width:32, height:32 }}/>
    </div>
  );

  if (!data) return (
    <div style={{ padding:40, textAlign:'center' }}>
      <p style={{ color:'var(--text-muted)' }}>Certificate not found.</p>
    </div>
  );

  const pct = parseFloat(data.percentage || 0);
  function getGrade(p) {
    if (p>=90) return 'A1'; if (p>=80) return 'B2'; if (p>=75) return 'B3';
    if (p>=70) return 'C4'; if (p>=65) return 'C5'; if (p>=60) return 'C6';
    if (p>=55) return 'D7'; if (p>=50) return 'E8'; return 'F9';
  }

  return (
    <div style={{ minHeight:'100dvh', background:'var(--bg-base)', padding:'24px 16px' }}>
      <Certificate
        candidate={data.candidate_name || 'Student'}
        exam={data.title || 'Examination'}
        score={data.score}
        percentage={pct}
        grade={getGrade(pct)}
        date={data.submitted_at ? new Date(data.submitted_at).toLocaleDateString('en-NG', { day:'numeric', month:'long', year:'numeric' }) : null}
        schoolName={settings.school_name}
        principalName={settings.principal_name}
        examOfficer={settings.exam_officer_name}
        certId={`EXAMOS-${sessionId?.slice(0,8).toUpperCase()}`}
      />
    </div>
  );
}

export default Certificate;
