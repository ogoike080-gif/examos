import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { examAPI, settingsAPI } from '../../utils/api';
import Button from '../../components/shared/Button';
import styles from './ResultSlip.module.css';

// ── Get grade from percentage using grading system ────────────
function getGrade(percentage, gradingSystem) {
  const pct = parseFloat(percentage) || 0;
  if (!Array.isArray(gradingSystem) || gradingSystem.length === 0) {
    // Default WAEC grading
    if (pct >= 90) return { grade: 'A1', remark: 'Excellent' };
    if (pct >= 80) return { grade: 'B2', remark: 'Very Good' };
    if (pct >= 75) return { grade: 'B3', remark: 'Good' };
    if (pct >= 70) return { grade: 'C4', remark: 'Credit' };
    if (pct >= 65) return { grade: 'C5', remark: 'Credit' };
    if (pct >= 60) return { grade: 'C6', remark: 'Credit' };
    if (pct >= 55) return { grade: 'D7', remark: 'Pass' };
    if (pct >= 50) return { grade: 'E8', remark: 'Pass' };
    return { grade: 'F9', remark: 'Fail' };
  }
  const match = gradingSystem.find(g => pct >= g.min && pct <= g.max);
  return match || { grade: 'F9', remark: 'Fail' };
}

// ── Progress bar ─────────────────────────────────────────────
function ScoreBar({ percentage, color }) {
  const pct = Math.min(Math.max(parseFloat(percentage) || 0, 0), 100);
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{
        height: 12, background: '#E8EAF0', borderRadius: 6,
        overflow: 'hidden', position: 'relative',
      }}>
        <div style={{
          width: `${pct}%`, height: '100%',
          background: color, borderRadius: 6,
          transition: 'width 1s ease',
        }} />
      </div>
      <div style={{
        display: 'flex', justifyContent: 'space-between',
        fontSize: 10, color: '#aaa', marginTop: 4,
        fontFamily: 'Arial, sans-serif',
      }}>
        <span>0%</span>
        <span>25%</span>
        <span>50%</span>
        <span>75%</span>
        <span>100%</span>
      </div>
    </div>
  );
}

export default function ResultSlip() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const [result, setResult] = useState(null);
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    loadData();
  }, [sessionId]);

  const loadData = async () => {
    try {
      const [resultRes, settingsRes] = await Promise.all([
        examAPI.results(sessionId),
        settingsAPI.get().catch(() => ({ data: { settings: {} } })),
      ]);
      setResult(resultRes.data.result);
      setSettings(settingsRes.data.settings || {});
    } catch (err) {
      setError(err.response?.data?.error || 'Could not load your result. Try again.');
    } finally {
      setLoading(false);
    }
  };

  if (loading) return (
    <div className={styles.loadScreen}>
      <div className="spinner" style={{ width: 36, height: 36 }} />
      <div className={styles.loadText}>Loading your result...</div>
    </div>
  );

  if (error) return (
    <div className={styles.loadScreen}>
      <div style={{ fontSize: 36, marginBottom: 12 }}>⚠</div>
      <div style={{ fontSize: 14, color: 'var(--red)', marginBottom: 16 }}>{error}</div>
      <Button onClick={() => navigate('/exam')}>← Back</Button>
    </div>
  );

  if (!result) return (
    <div className={styles.loadScreen}>
      <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>Result not found.</div>
      <Button variant="ghost" onClick={() => navigate('/exam')} style={{ marginTop: 12 }}>← Back</Button>
    </div>
  );

  // ── Calculate everything ──────────────────────────────────
  const score       = parseFloat(result.score) || 0;
  const examTotal   = parseFloat(result.exam_total) || 100;
  const passMark    = parseFloat(result.pass_marks) || (examTotal * 0.5);
  const pct         = examTotal > 0 ? (score / examTotal) * 100 : 0;
  const passed      = score >= passMark;

  const gradingSystem = Array.isArray(settings?.result_grading_system)
    ? settings.result_grading_system
    : [];
  const { grade, remark } = getGrade(pct, gradingSystem);

  const themeColor  = settings?.result_color || '#1A6BFF';
  const schoolName  = settings?.school_name  || 'Ogotech Conventional/Technical School';
  const schoolMotto = settings?.school_motto || 'Excellence Through Knowledge and Skills';

  const submittedAt = result.submitted_at
    ? new Date(result.submitted_at).toLocaleString('en-NG', {
        day: '2-digit', month: 'long', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      })
    : '—';

  // Dynamic teacher comment
  const teacherComment = pct >= 90 ? 'Outstanding performance! Truly exceptional result. Keep aiming high.'
    : pct >= 75 ? 'Excellent work! This student demonstrates strong mastery of the subject.'
    : pct >= 60 ? 'Good performance. Continue working hard to achieve even better results.'
    : pct >= 50 ? 'Satisfactory result. With more dedication, this student can improve significantly.'
    : pct >= 40 ? 'This student needs to study harder and seek help from their teacher.'
    : 'Very poor performance. This student must put in much more effort and attend extra lessons.';

  // Status colour
  const statusColor = passed ? '#16A34A' : '#DC2626';
  const statusBg    = passed ? 'rgba(22,163,74,0.1)' : 'rgba(220,38,38,0.1)';
  const statusBorder = passed ? 'rgba(22,163,74,0.3)' : 'rgba(220,38,38,0.3)';

  return (
    <div className={styles.pageWrapper}>

      {/* Screen-only controls */}
      <div className={styles.controls}>
        <Button variant="ghost" onClick={() => navigate('/exam')}>← Back to Dashboard</Button>
        <Button onClick={() => window.print()} icon="🖨">Print / Save as PDF</Button>
      </div>

      {/* ════════════════ THE RESULT SLIP ════════════════ */}
      <div className={styles.slip} id="result-slip">

        {/* ── HEADER ── */}
        <div className={styles.header} style={{ background: themeColor }}>
          <div className={styles.headerContent}>
            <div className={styles.logoArea}>
              {settings?.school_logo_url ? (
                <img src={settings.school_logo_url} alt="logo" className={styles.logoImg} />
              ) : (
                <div className={styles.logoPlaceholder}>
                  {settings?.school_short_name?.charAt(0) || 'O'}
                </div>
              )}
            </div>
            <div className={styles.schoolInfo}>
              <div className={styles.schoolName}>{schoolName}</div>
              <div className={styles.schoolMotto}>"{schoolMotto}"</div>
              <div className={styles.schoolContact}>
                {settings?.school_address && <span>{settings.school_address}</span>}
                {settings?.school_phone && <span> · {settings.school_phone}</span>}
                {settings?.school_email && <span> · {settings.school_email}</span>}
              </div>
            </div>
            <div className={styles.emblem}>
              <div className={styles.emblemCircle}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 11, fontWeight: 800, color: '#fff', letterSpacing: '0.06em', fontFamily: 'Arial Black, sans-serif' }}>RESULT</div>
                  <div style={{ fontSize: 11, fontWeight: 800, color: '#fff', letterSpacing: '0.06em', fontFamily: 'Arial Black, sans-serif' }}>SLIP</div>
                </div>
              </div>
            </div>
          </div>
          <div className={styles.titleStrip}>
            COMPUTER-BASED TEST RESULT SLIP
          </div>
        </div>

        {/* ── CANDIDATE INFO ── */}
        <div className={styles.candidateStrip}>
          <div className={styles.candidateGrid}>
            {[
              ['Candidate Name', result.candidate_name || '—'],
              ['Exam',          result.title || '—'],
              ['Subject',       result.subject_name || '—'],
              ['Reference No.', sessionId?.slice(0, 12).toUpperCase() || '—'],
              ['Date',          submittedAt],
              ['Status',        result.status?.toUpperCase() || '—'],
            ].map(([key, val]) => (
              <div key={key} className={styles.candidateField}>
                <span className={styles.fieldKey}>{key}</span>
                <span className={styles.fieldVal}>{val}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ── PASS / FAIL BANNER ── */}
        <div style={{
          background: statusBg,
          border: `2px solid ${statusBorder}`,
          margin: '20px 32px 0',
          borderRadius: 12,
          padding: '14px 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{
              width: 48, height: 48,
              background: statusColor,
              borderRadius: '50%',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 22, color: '#fff', fontWeight: 900,
              flexShrink: 0,
            }}>
              {passed ? '✓' : '✗'}
            </div>
            <div>
              <div style={{
                fontFamily: 'Arial Black, sans-serif',
                fontSize: 22, fontWeight: 900,
                color: statusColor, letterSpacing: '0.02em',
              }}>
                {passed ? 'PASSED' : 'FAILED'}
              </div>
              <div style={{ fontSize: 12, color: '#555', marginTop: 2 }}>
                {passed
                  ? `Congratulations! You scored above the pass mark of ${passMark} marks.`
                  : `You did not reach the pass mark of ${passMark} marks. Study harder and try again.`}
              </div>
            </div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 10, color: '#999', letterSpacing: '0.06em', textTransform: 'uppercase', fontFamily: 'Arial, sans-serif', marginBottom: 2 }}>Pass Mark</div>
            <div style={{ fontFamily: 'Arial Black, sans-serif', fontSize: 20, fontWeight: 900, color: '#333' }}>
              {passMark}/{examTotal}
            </div>
          </div>
        </div>

        {/* ── SCORE SECTION ── */}
        <div className={styles.scoreSection}>

          {/* Score card */}
          <div className={styles.scoreCard} style={{ borderLeftColor: themeColor }}>
            <div className={styles.scoreLabel}>TOTAL SCORE</div>
            <div className={styles.scoreMain} style={{ color: themeColor }}>
              {score % 1 === 0 ? score : score.toFixed(1)}
              <span className={styles.scoreTotal}>/{examTotal}</span>
            </div>
            <div className={styles.scorePercent}>{pct.toFixed(1)}%</div>
            <ScoreBar percentage={pct} color={themeColor} />
          </div>

          {/* Grade card */}
          <div className={styles.gradeCard} style={{ borderColor: themeColor }}>
            <div className={styles.gradeLabel}>GRADE</div>
            <div className={styles.gradeMain} style={{ color: passed ? themeColor : '#DC2626' }}>
              {grade}
            </div>
            <div className={styles.gradeRemark} style={{ color: passed ? '#16A34A' : '#DC2626' }}>
              {remark}
            </div>
            <div style={{
              marginTop: 10,
              padding: '4px 16px',
              borderRadius: 20,
              background: statusBg,
              border: `1.5px solid ${statusBorder}`,
              color: statusColor,
              fontFamily: 'Arial, sans-serif',
              fontSize: 12, fontWeight: 700,
              display: 'inline-block',
            }}>
              {passed ? '✓ PASSED' : '✗ FAILED'}
            </div>
          </div>

          {/* Breakdown */}
          <div className={styles.breakdownCard}>
            <div className={styles.breakdownTitle}>PERFORMANCE SUMMARY</div>
            {[
              ['Score Obtained', `${score % 1 === 0 ? score : score.toFixed(1)} marks`],
              ['Maximum Score',  `${examTotal} marks`],
              ['Pass Mark',      `${passMark} marks`],
              ['Percentage',     `${pct.toFixed(2)}%`],
              ['Grade',          grade],
              ['Remark',         remark],
              ['Result',         passed ? 'PASSED ✓' : 'FAILED ✗'],
            ].map(([k, v]) => (
              <div key={k} className={styles.breakdownItem}>
                <span className={styles.breakdownKey}>{k}</span>
                <span className={styles.breakdownVal}
                  style={{ color: k === 'Result' ? statusColor : undefined }}>
                  {v}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* ── GRADING SCALE ── */}
        {gradingSystem.length > 0 && (
          <div className={styles.gradingSection}>
            <div className={styles.gradingSectionTitle}>GRADING SCALE</div>
            <div className={styles.gradingRow}>
              {gradingSystem.map((g, i) => {
                const isCurrentGrade = grade === g.grade;
                return (
                  <div key={i}
                    className={`${styles.gradingCell} ${isCurrentGrade ? styles.gradingCellActive : ''}`}
                    style={isCurrentGrade ? { background: themeColor, color: '#fff' } : {}}
                  >
                    <div className={styles.gradingCellGrade}>{g.grade}</div>
                    <div className={styles.gradingCellRange}>{g.min}–{g.max}%</div>
                    <div className={styles.gradingCellRemark}>{g.remark}</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── FAIL NOTICE (only shown when failed) ── */}
        {!passed && (
          <div style={{
            margin: '0 32px',
            padding: '16px 20px',
            background: 'rgba(220,38,38,0.06)',
            border: '1.5px solid rgba(220,38,38,0.2)',
            borderRadius: 10,
            display: 'flex',
            gap: 14,
            alignItems: 'flex-start',
          }}>
            <div style={{ fontSize: 28, flexShrink: 0 }}>📖</div>
            <div>
              <div style={{
                fontFamily: 'Arial Black, sans-serif',
                fontSize: 13, fontWeight: 900,
                color: '#DC2626', marginBottom: 5,
                letterSpacing: '0.02em',
              }}>
                IMPROVEMENT REQUIRED
              </div>
              <div style={{ fontSize: 12, color: '#555', lineHeight: 1.7 }}>
                You scored <strong>{pct.toFixed(1)}%</strong> which is below the required pass mark of{' '}
                <strong>{((passMark / examTotal) * 100).toFixed(0)}%</strong>.
                Please review your study materials, attend extra classes, and try again.
                Your teacher is available to help you improve.
              </div>
            </div>
          </div>
        )}

        {/* ── TEACHER COMMENT ── */}
        {settings?.result_show_teacher_comment !== false && (
          <div className={styles.commentSection}>
            <div className={styles.commentTitle}>CLASS TEACHER'S COMMENT</div>
            <div className={styles.commentBox} style={{ borderLeftColor: themeColor }}>
              <div className={styles.commentQuote}>"</div>
              <div className={styles.commentText}>{teacherComment}</div>
            </div>
          </div>
        )}

        {/* ── SIGNATURES ── */}
        <div className={styles.signaturesSection}>
          <div className={styles.signatureItem}>
            <div className={styles.signatureLine} />
            <div className={styles.signatureName}>{settings?.principal_name || '______________________'}</div>
            <div className={styles.signatureTitle}>{settings?.principal_title || 'Principal'}</div>
          </div>

          <div className={styles.signatureItem}>
            <div className={styles.stampBox} style={{ borderColor: themeColor, color: themeColor }}>
              <div className={styles.stampSchool}>{settings?.school_short_name || 'OGT'}</div>
              <div className={styles.stampOfficial}>{settings?.stamp_text || 'OFFICIAL RESULT'}</div>
              <div className={styles.stampDate}>
                {new Date().toLocaleDateString('en-NG', { day:'2-digit', month:'short', year:'numeric' })}
              </div>
            </div>
          </div>

          <div className={styles.signatureItem}>
            <div className={styles.signatureLine} />
            <div className={styles.signatureName}>{settings?.exam_officer_name || '______________________'}</div>
            <div className={styles.signatureTitle}>Exam Officer</div>
          </div>
        </div>

        {/* ── FOOTER ── */}
        <div className={styles.footer} style={{ borderTopColor: themeColor + '30', background: themeColor + '10' }}>
          <div className={styles.footerLeft}>
            <span style={{ fontFamily: 'monospace', fontSize: 10, color: '#aaa' }}>
              REF: {sessionId?.slice(0, 16).toUpperCase()}
            </span>
          </div>
          <div className={styles.footerCenter}>
            {settings?.result_footer || 'This result is computer-generated and valid without signature.'}
          </div>
          <div className={styles.footerRight}>ExamOS 2026</div>
        </div>

      </div>
      {/* ════════════ END RESULT SLIP ════════════ */}

    </div>
  );
}
