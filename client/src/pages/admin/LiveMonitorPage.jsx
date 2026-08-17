import React, { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { proctorAPI, examAPI } from '../../utils/api';
import { useSocketStore } from '../../store';
import Button from '../../components/shared/Button';
import styles from './LiveMonitorPage.module.css';

function CandidateCard({ session, onAction }) {
  const severity = session.critical_count > 0 ? 'critical'
    : session.warning_count > 0 ? 'warning' : 'normal';

  const statusCls = {
    active: styles.statusActive,
    paused: styles.statusPaused,
    disconnected: styles.statusDisconnected,
    submitted: styles.statusSubmitted,
  }[session.status] || styles.statusActive;

  const progress = session.total_questions > 0
    ? Math.round((session.answers_count / session.total_questions) * 100) : 0;

  return (
    <div className={`${styles.card} ${severity === 'critical' ? styles.cardCritical : severity === 'warning' ? styles.cardWarning : ''}`}>
      {severity !== 'normal' && <div className={`${styles.cardStripe} ${severity === 'critical' ? styles.stripeCritical : styles.stripeWarning}`} />}

      <div className={styles.cardHead}>
        <div className={styles.avatar}>
          {session.candidate_name?.charAt(0) || '?'}
        </div>
        <div className={styles.cardInfo}>
          <div className={styles.candidateName}>{session.candidate_name}</div>
          <div className={styles.sessionId}>{session.id?.slice(0, 8).toUpperCase()}</div>
        </div>
        <span className={`tag ${statusCls}`}>{session.status}</span>
      </div>

      {/* Simulated camera feed */}
      <div className={`${styles.camFeed} ${session.status === 'disconnected' ? styles.camOffline : ''}`}>
        {session.status === 'disconnected' ? (
          <div className={styles.camOfflineText}>NO SIGNAL</div>
        ) : (
          <>
            <div className={styles.camFigure}>
              <div className={styles.camHead} />
              <div className={styles.camBody} />
            </div>
            <div className={styles.camScan} />
          </>
        )}
        <div className={styles.camCorner}>LIVE</div>
        {session.critical_count > 0 && (
          <div className={styles.camAlert}>⚠ {session.critical_count} CRITICAL</div>
        )}
      </div>

      {/* Violation alerts */}
      {session.critical_count > 0 && (
        <div className={styles.alertBadge}>
          ⚠ {session.critical_count} critical violation{session.critical_count > 1 ? 's' : ''}
        </div>
      )}
      {session.warning_count > 0 && session.critical_count === 0 && (
        <div className={styles.warnBadge}>
          ⚑ {session.warning_count} warning{session.warning_count > 1 ? 's' : ''}
        </div>
      )}

      <div className={styles.progressRow}>
        <span className={styles.progressText}>Q {session.answers_count}/{session.total_questions}</span>
        <div className={styles.progressBar}>
          <div className={styles.progressFill} style={{ width: `${progress}%` }} />
        </div>
        <span className={styles.progressPct}>{session.elapsed_minutes}m</span>
      </div>

      <div className={styles.cardActions}>
        <button className={styles.actionBtn} onClick={() => onAction(session.id, 'warn', 'Please maintain exam integrity.')}>Warn</button>
        {session.status === 'active' && (
          <button className={styles.actionBtn} onClick={() => onAction(session.id, 'pause', 'Session paused by proctor.')}>Pause</button>
        )}
        {session.status === 'paused' && (
          <button className={`${styles.actionBtn} ${styles.actionBtnGreen}`} onClick={() => onAction(session.id, 'resume', '')}>Resume</button>
        )}
        <button className={`${styles.actionBtn} ${styles.actionBtnRed}`} onClick={() => {
          if (confirm(`Disqualify ${session.candidate_name}?`)) onAction(session.id, 'disqualify', 'Disqualified by proctor.');
        }}>Disqualify</button>
      </div>
    </div>
  );
}

export default function LiveMonitorPage() {
  const [searchParams] = useSearchParams();
  const examId = searchParams.get('exam');
  const { liveViolations, connect } = useSocketStore();

  const [sessions, setSessions] = useState([]);
  const [summary, setSummary] = useState([]);
  const [exams, setExams] = useState([]);
  const [selectedExam, setSelectedExam] = useState(examId || '');
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(true);

  useEffect(() => {
    examAPI.list({ status: 'active' }).then(r => setExams(r.data.exams || []));
    load();
  }, [selectedExam]);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(load, 8000);
    return () => clearInterval(interval);
  }, [autoRefresh, selectedExam]);

  const load = async () => {
    try {
      const res = await proctorAPI.getLive(selectedExam || undefined);
      setSessions(res.data.sessions || []);
      setSummary(res.data.summary || []);
    } catch { /* silent */ }
    finally { setLoading(false); }
  };

  const handleAction = async (sessionId, action, reason) => {
    try {
      await proctorAPI.action(sessionId, action, reason);
      toast.success(`Action applied: ${action}`);
      load();
    } catch { toast.error('Action failed'); }
  };

  const filtered = sessions.filter(s => {
    if (filter === 'flagged') return s.critical_count > 0 || s.warning_count > 0;
    if (filter === 'active') return s.status === 'active';
    if (filter === 'disconnected') return s.status === 'disconnected';
    return true;
  });

  const summaryMap = {};
  summary.forEach(s => { summaryMap[s.status] = s.count; });

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>Live Monitor</h1>
          <p className={styles.pageSub}>
            Real-time proctoring · {sessions.length} active sessions
            {autoRefresh && <span className={styles.liveTag}>● Auto-refreshing</span>}
          </p>
        </div>
        <div className={styles.headerActions}>
          <select
            value={selectedExam}
            onChange={e => setSelectedExam(e.target.value)}
            style={{ padding: '7px 12px', borderRadius: 8, fontSize: 13 }}
          >
            <option value="">All exams</option>
            {exams.map(e => <option key={e.id} value={e.id}>{e.title}</option>)}
          </select>
          <Button variant="ghost" size="sm" onClick={() => setAutoRefresh(r => !r)}>
            {autoRefresh ? '⏸ Pause' : '▶ Resume'} Refresh
          </Button>
          <Button variant="danger" size="sm" onClick={() => {
            if (confirm('Broadcast pause to ALL candidates?')) toast('Broadcast sent');
          }}>
            Broadcast Pause
          </Button>
        </div>
      </div>

      {/* Stats bar */}
      <div className={styles.statsBar}>
        {[
          { label: 'Active', key: 'active', color: 'var(--green)', icon: '●' },
          { label: 'Flagged', value: sessions.filter(s => s.critical_count > 0).length, color: 'var(--red)', icon: '⚠' },
          { label: 'Warnings', value: sessions.filter(s => s.warning_count > 0 && s.critical_count === 0).length, color: 'var(--amber)', icon: '⚑' },
          { label: 'Disconnected', key: 'disconnected', color: 'var(--text-muted)', icon: '◌' },
          { label: 'Submitted', key: 'submitted', color: 'var(--blue)', icon: '✓' },
          { label: 'Disqualified', key: 'disqualified', color: 'var(--red)', icon: '✕' },
        ].map(stat => (
          <div key={stat.label} className={styles.statItem}>
            <span style={{ color: stat.color }}>{stat.icon}</span>
            <span className={styles.statVal} style={{ color: stat.color }}>
              {stat.value ?? summaryMap[stat.key] ?? 0}
            </span>
            <span className={styles.statLabel}>{stat.label}</span>
          </div>
        ))}
      </div>

      {/* Filter tabs + violation feed */}
      <div className={styles.toolRow}>
        <div className={styles.filters}>
          {['all', 'flagged', 'active', 'disconnected'].map(f => (
            <button
              key={f}
              className={`${styles.filterBtn} ${filter === f ? styles.filterActive : ''}`}
              onClick={() => setFilter(f)}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
              {f === 'flagged' && sessions.filter(s => s.critical_count > 0).length > 0 && (
                <span className={styles.filterBadge}>{sessions.filter(s => s.critical_count > 0).length}</span>
              )}
            </button>
          ))}
        </div>

        <Button size="sm" variant="ghost" onClick={load}>↻ Refresh</Button>
      </div>

      <div className={styles.contentGrid}>
        {/* Candidate grid */}
        <div>
          {loading ? (
            <div className={styles.loadState}><div className="spinner" style={{ width: 28, height: 28 }} /></div>
          ) : filtered.length === 0 ? (
            <div className={styles.emptyState}>
              <div className={styles.emptyIcon}>🔍</div>
              <div>No candidates match this filter</div>
              {sessions.length === 0 && <div style={{ fontSize: 12, marginTop: 6 }}>No active sessions. Start an exam from the dashboard.</div>}
            </div>
          ) : (
            <div className={styles.candidateGrid}>
              {filtered.map(s => (
                <CandidateCard key={s.id} session={s} onAction={handleAction} />
              ))}
            </div>
          )}
        </div>

        {/* Violations feed */}
        <div className={styles.violationFeed}>
          <div className={styles.feedHeader}>
            <span className={styles.feedTitle}>Live Violations</span>
            <span className={styles.feedCount}>{liveViolations.length}</span>
          </div>
          <div className={styles.feedList}>
            {liveViolations.length === 0 && (
              <div className={styles.feedEmpty}>No violations detected</div>
            )}
            {liveViolations.map((v, i) => (
              <div key={i} className={styles.feedItem}>
                <div className={styles.feedItemTop}>
                  <span className={styles.feedName}>{v.candidate?.email?.split('@')[0]}</span>
                  <span className={`tag tag-${v.metadata?.severity === 'critical' ? 'red' : 'amber'}`}>
                    {v.event_type?.replace(/_/g, ' ')}
                  </span>
                </div>
                <div className={styles.feedTime}>
                  {new Date(v.timestamp).toLocaleTimeString()}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
