import React, { useEffect, useState } from 'react';
import axios from 'axios';

const API = '/api';

// ── XP & Level System ────────────────────────────────────────
export function calcLevel(xp) {
  // Level = floor(sqrt(xp / 100)) + 1
  const level = Math.floor(Math.sqrt(xp / 100)) + 1;
  const currentLevelXP = Math.pow(level - 1, 2) * 100;
  const nextLevelXP = Math.pow(level, 2) * 100;
  const progress = ((xp - currentLevelXP) / (nextLevelXP - currentLevelXP)) * 100;
  return { level, progress: Math.min(progress, 100), nextLevelXP, currentLevelXP };
}

export const BADGES = [
  { id:'first_exam',    icon:'🎯', name:'First Step',      desc:'Completed your first exam',         xp:50  },
  { id:'perfect_score', icon:'💯', name:'Perfect Score',   desc:'Scored 100% on an exam',            xp:200 },
  { id:'five_exams',    icon:'🔥', name:'On Fire',         desc:'Completed 5 exams',                 xp:100 },
  { id:'ten_exams',     icon:'⚡', name:'Exam Warrior',    desc:'Completed 10 exams',                xp:150 },
  { id:'pass_streak_3', icon:'🌟', name:'Hat Trick',       desc:'Passed 3 exams in a row',           xp:120 },
  { id:'pass_streak_5', icon:'👑', name:'Champion',        desc:'Passed 5 exams in a row',           xp:250 },
  { id:'early_bird',    icon:'🌅', name:'Early Bird',      desc:'Completed an exam before 8am',      xp:75  },
  { id:'speed_demon',   icon:'💨', name:'Speed Demon',     desc:'Finished exam with 50%+ time left', xp:100 },
  { id:'improver',      icon:'📈', name:'Improver',        desc:'Scored higher than your last exam', xp:80  },
  { id:'scholar',       icon:'🎓', name:'Scholar',         desc:'Average score above 80%',           xp:175 },
];

// ── XP Progress Ring ─────────────────────────────────────────
export function XPRing({ xp = 0, size = 80 }) {
  const { level, progress } = calcLevel(xp);
  const r = (size / 2) - 6;
  const circ = 2 * Math.PI * r;
  const dash = (progress / 100) * circ;

  return (
    <div style={{ position:'relative', width:size, height:size, flexShrink:0 }}>
      <svg width={size} height={size} style={{ transform:'rotate(-90deg)' }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="var(--bg-overlay)" strokeWidth={5}/>
        <circle cx={size/2} cy={size/2} r={r} fill="none"
          stroke="url(#xpGrad)" strokeWidth={5}
          strokeDasharray={`${dash} ${circ}`}
          strokeLinecap="round"
          style={{ transition:'stroke-dasharray 0.8s cubic-bezier(0.4,0,0.2,1)' }}
        />
        <defs>
          <linearGradient id="xpGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#6366F1"/>
            <stop offset="100%" stopColor="#A78BFA"/>
          </linearGradient>
        </defs>
      </svg>
      <div style={{
        position:'absolute', inset:0,
        display:'flex', flexDirection:'column',
        alignItems:'center', justifyContent:'center',
      }}>
        <div style={{ fontFamily:'var(--font-display)', fontSize:size>60?18:14, fontWeight:900, color:'var(--brand-light)', lineHeight:1 }}>
          {level}
        </div>
        <div style={{ fontSize:size>60?9:8, color:'var(--text-muted)', fontWeight:700, letterSpacing:'0.05em' }}>LVL</div>
      </div>
    </div>
  );
}

// ── Badge Card ───────────────────────────────────────────────
export function BadgeCard({ badge, earned = false, earnedAt = null }) {
  return (
    <div style={{
      background:'var(--bg-surface)',
      border:`1px solid ${earned ? 'rgba(99,102,241,0.3)' : 'var(--border)'}`,
      borderRadius:'var(--r-xl)',
      padding:'16px',
      textAlign:'center',
      transition:'all var(--t-base)',
      opacity: earned ? 1 : 0.45,
      filter: earned ? 'none' : 'grayscale(1)',
      position:'relative',
      overflow:'hidden',
    }}
      onMouseOver={e => { if (earned) { e.currentTarget.style.transform='translateY(-2px)'; e.currentTarget.style.boxShadow='var(--shadow-md)'; }}}
      onMouseOut={e => { e.currentTarget.style.transform=''; e.currentTarget.style.boxShadow=''; }}
    >
      {earned && (
        <div style={{
          position:'absolute', top:0, left:0, right:0, height:2,
          background:'linear-gradient(90deg, var(--brand-dark), var(--brand-light))',
        }}/>
      )}
      <div style={{ fontSize:32, marginBottom:8 }}>{badge.icon}</div>
      <div style={{ fontSize:12, fontWeight:700, color:'var(--text-primary)', marginBottom:4 }}>{badge.name}</div>
      <div style={{ fontSize:10, color:'var(--text-muted)', lineHeight:1.5, marginBottom:6 }}>{badge.desc}</div>
      <div style={{
        display:'inline-flex', alignItems:'center', gap:4,
        padding:'2px 8px', borderRadius:'var(--r-full)',
        background:'var(--brand-dim)', color:'var(--brand-light)',
        fontSize:10, fontWeight:700,
      }}>+{badge.xp} XP</div>
      {earned && earnedAt && (
        <div style={{ fontSize:9, color:'var(--text-dim)', marginTop:6 }}>
          {new Date(earnedAt).toLocaleDateString('en-NG')}
        </div>
      )}
      {!earned && (
        <div style={{ fontSize:9, color:'var(--text-dim)', marginTop:6 }}>🔒 Locked</div>
      )}
    </div>
  );
}

// ── Streak Display ───────────────────────────────────────────
export function StreakDisplay({ streak = 0, lastActive = null }) {
  const isActiveToday = lastActive && new Date(lastActive).toDateString() === new Date().toDateString();

  return (
    <div style={{
      background:'var(--bg-surface)',
      border:'1px solid var(--border)',
      borderRadius:'var(--r-xl)',
      padding:'16px 20px',
      display:'flex', alignItems:'center', gap:16,
    }}>
      <div style={{
        width:52, height:52, borderRadius:'50%',
        background: streak > 0 ? 'linear-gradient(135deg, #F59E0B, #EF4444)' : 'var(--bg-raised)',
        display:'flex', alignItems:'center', justifyContent:'center',
        fontSize:24, flexShrink:0,
        boxShadow: streak > 0 ? '0 4px 16px rgba(245,158,11,0.3)' : 'none',
        animation: streak > 0 ? 'float 3s ease-in-out infinite' : 'none',
      }}>
        {streak > 0 ? '🔥' : '💤'}
      </div>
      <div style={{ flex:1 }}>
        <div style={{ fontFamily:'var(--font-display)', fontSize:24, fontWeight:900, letterSpacing:'-0.03em', color: streak > 0 ? '#F59E0B' : 'var(--text-muted)', lineHeight:1 }}>
          {streak} day{streak !== 1 ? 's' : ''}
        </div>
        <div style={{ fontSize:12, color:'var(--text-muted)', marginTop:2 }}>
          {streak === 0 ? 'Start your streak today!'
            : isActiveToday ? '✓ Active today — keep it up!'
            : '⚠ Complete an exam today to maintain your streak'}
        </div>
      </div>
      {streak >= 7 && (
        <div style={{
          padding:'4px 12px', borderRadius:'var(--r-full)',
          background:'linear-gradient(135deg, rgba(245,158,11,0.2), rgba(239,68,68,0.2))',
          border:'1px solid rgba(245,158,11,0.4)',
          fontSize:11, fontWeight:700, color:'#F59E0B',
          whiteSpace:'nowrap',
        }}>
          🏆 {streak >= 30 ? 'Legend' : streak >= 14 ? 'Master' : 'Hot streak'}
        </div>
      )}
    </div>
  );
}

// ── Leaderboard ──────────────────────────────────────────────
export function Leaderboard({ data = [], currentUserId = null }) {
  const medals = ['🥇','🥈','🥉'];

  return (
    <div style={{ background:'var(--bg-surface)', border:'1px solid var(--border)', borderRadius:'var(--r-xl)', overflow:'hidden' }}>
      <div style={{ padding:'16px 20px', borderBottom:'1px solid var(--border)', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
        <div>
          <h3 style={{ fontSize:'0.95rem', marginBottom:2 }}>Leaderboard</h3>
          <p style={{ fontSize:11, color:'var(--text-muted)' }}>Top performers this month</p>
        </div>
        <span style={{ fontSize:20 }}>🏆</span>
      </div>
      {data.length === 0 ? (
        <div style={{ padding:'32px', textAlign:'center', color:'var(--text-muted)', fontSize:13 }}>
          No data yet. Complete exams to appear here.
        </div>
      ) : (
        data.slice(0,10).map((entry, i) => {
          const isMe = entry.id === currentUserId;
          const { level } = calcLevel(entry.xp || 0);
          return (
            <div key={entry.id} style={{
              display:'flex', alignItems:'center', gap:12,
              padding:'12px 20px',
              borderBottom: i < data.length - 1 ? '1px solid var(--border)' : 'none',
              background: isMe ? 'var(--brand-dim)' : 'transparent',
              transition:'background var(--t-fast)',
            }}>
              <div style={{
                width:28, height:28, borderRadius:'50%', flexShrink:0,
                display:'flex', alignItems:'center', justifyContent:'center',
                fontSize:i < 3 ? 18 : 12, fontWeight:700,
                color: i < 3 ? 'inherit' : 'var(--text-muted)',
                fontFamily:'var(--font-display)',
              }}>
                {i < 3 ? medals[i] : `#${i+1}`}
              </div>
              <div style={{
                width:34, height:34, borderRadius:'50%', flexShrink:0,
                background: isMe ? 'var(--brand)' : 'var(--bg-overlay)',
                display:'flex', alignItems:'center', justifyContent:'center',
                fontFamily:'var(--font-display)', fontSize:14, fontWeight:800,
                color: isMe ? '#fff' : 'var(--text-secondary)',
              }}>
                {entry.full_name?.charAt(0) || '?'}
              </div>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:13, fontWeight: isMe ? 700 : 600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', color: isMe ? 'var(--brand-light)' : 'var(--text-primary)' }}>
                  {entry.full_name}{isMe ? ' (You)' : ''}
                </div>
                <div style={{ fontSize:10, color:'var(--text-muted)', marginTop:1 }}>
                  Level {level} · {entry.exams_taken || 0} exams
                </div>
              </div>
              <div style={{ textAlign:'right', flexShrink:0 }}>
                <div style={{ fontFamily:'var(--font-display)', fontSize:15, fontWeight:800, color:'var(--brand-light)' }}>
                  {(entry.xp || 0).toLocaleString()}
                </div>
                <div style={{ fontSize:9, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.06em' }}>XP</div>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

// ── XP Toast notification ────────────────────────────────────
export function XPToast({ xp, badge = null, onDone }) {
  useEffect(() => {
    const t = setTimeout(onDone, 3500);
    return () => clearTimeout(t);
  }, []);

  return (
    <div style={{
      position:'fixed', top:80, left:'50%', transform:'translateX(-50%)',
      background:'var(--bg-glass)',
      backdropFilter:'blur(20px)',
      WebkitBackdropFilter:'blur(20px)',
      border:'1px solid var(--border-md)',
      borderRadius:'var(--r-xl)',
      padding:'14px 20px',
      display:'flex', alignItems:'center', gap:12,
      boxShadow:'var(--shadow-xl)',
      zIndex:9999,
      animation:'fadeInUp 0.4s cubic-bezier(0.34,1.56,0.64,1) both',
      minWidth:220,
    }}>
      <div style={{ fontSize:28 }}>{badge ? badge.icon : '⚡'}</div>
      <div>
        {badge && <div style={{ fontSize:13, fontWeight:700, color:'var(--text-primary)', marginBottom:2 }}>
          {badge.name} Unlocked!
        </div>}
        <div style={{ display:'flex', alignItems:'center', gap:6 }}>
          <span style={{ fontFamily:'var(--font-display)', fontSize:18, fontWeight:900, color:'var(--brand-light)' }}>+{xp}</span>
          <span style={{ fontSize:12, fontWeight:700, color:'var(--text-muted)' }}>XP earned</span>
        </div>
      </div>
    </div>
  );
}

// ── Profile / Stats page for students ────────────────────────
export function StudentProfile() {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('overview');

  useEffect(() => {
    axios.get(`${API}/gamification/profile`)
      .then(r => setProfile(r.data))
      .catch(() => setProfile({ xp:0, streak:0, badges:[], leaderboard:[] }))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <div style={{ maxWidth:640, margin:'0 auto', padding:'24px 16px' }}>
      <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
        {[80,120,200].map(h => <div key={h} className="skeleton" style={{ height:h, borderRadius:'var(--r-xl)' }}/>)}
      </div>
    </div>
  );

  const { level, progress, nextLevelXP, currentLevelXP } = calcLevel(profile?.xp || 0);
  const xp = profile?.xp || 0;
  const streak = profile?.streak || 0;
  const earnedBadges = new Set((profile?.badges || []).map(b => b.badge_id));

  return (
    <div style={{ maxWidth:640, margin:'0 auto', padding:'24px 16px 40px' }}>

      {/* Header card */}
      <div style={{
        background:'linear-gradient(135deg, var(--brand-dark), var(--brand), var(--brand-light))',
        borderRadius:'var(--r-2xl)', padding:'24px 20px', marginBottom:16,
        position:'relative', overflow:'hidden',
      }}>
        <div style={{ position:'absolute', top:-30, right:-30, width:120, height:120, borderRadius:'50%', background:'rgba(255,255,255,0.06)' }}/>
        <div style={{ position:'absolute', bottom:-20, left:-20, width:80, height:80, borderRadius:'50%', background:'rgba(255,255,255,0.04)' }}/>

        <div style={{ display:'flex', alignItems:'center', gap:16, position:'relative', zIndex:1 }}>
          <XPRing xp={xp} size={80} />
          <div style={{ flex:1 }}>
            <div style={{ fontFamily:'var(--font-display)', fontSize:'1.4rem', fontWeight:900, color:'#fff', marginBottom:2 }}>
              {profile?.full_name || 'Student'}
            </div>
            <div style={{ fontSize:12, color:'rgba(255,255,255,0.7)', marginBottom:10 }}>
              {profile?.class_name || ''} · {xp.toLocaleString()} XP total
            </div>
            {/* Level progress bar */}
            <div>
              <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4 }}>
                <span style={{ fontSize:10, color:'rgba(255,255,255,0.6)' }}>Level {level}</span>
                <span style={{ fontSize:10, color:'rgba(255,255,255,0.6)' }}>Level {level+1}</span>
              </div>
              <div style={{ height:6, background:'rgba(255,255,255,0.2)', borderRadius:3, overflow:'hidden' }}>
                <div style={{ height:'100%', width:`${progress}%`, background:'#fff', borderRadius:3, transition:'width 1s ease' }}/>
              </div>
              <div style={{ fontSize:10, color:'rgba(255,255,255,0.5)', marginTop:4, textAlign:'center' }}>
                {xp - currentLevelXP} / {nextLevelXP - currentLevelXP} XP to next level
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Streak */}
      <div style={{ marginBottom:16 }}>
        <StreakDisplay streak={streak} lastActive={profile?.last_active} />
      </div>

      {/* Stats row */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:10, marginBottom:16 }}>
        {[
          { label:'Exams Done',  val: profile?.exams_taken || 0,          icon:'📝' },
          { label:'Avg Score',   val: `${(profile?.avg_score||0).toFixed(0)}%`, icon:'📊' },
          { label:'Badges',      val: earnedBadges.size,                   icon:'🏅' },
        ].map(s => (
          <div key={s.label} style={{ background:'var(--bg-surface)', border:'1px solid var(--border)', borderRadius:'var(--r-lg)', padding:'14px', textAlign:'center' }}>
            <div style={{ fontSize:20, marginBottom:6 }}>{s.icon}</div>
            <div style={{ fontFamily:'var(--font-display)', fontSize:20, fontWeight:900, color:'var(--brand-light)', letterSpacing:'-0.03em' }}>{s.val}</div>
            <div style={{ fontSize:10, color:'var(--text-muted)', fontWeight:700, textTransform:'uppercase', letterSpacing:'0.06em', marginTop:2 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ display:'flex', background:'var(--bg-raised)', borderRadius:'var(--r)', padding:4, marginBottom:16, border:'1px solid var(--border)' }}>
        {[['overview','Overview'],['badges','Badges'],['leaderboard','Rankings']].map(([id,label]) => (
          <button key={id} onClick={() => setActiveTab(id)} style={{
            flex:1, padding:'8px', border:'none', borderRadius:8, cursor:'pointer',
            background: activeTab===id ? 'var(--brand)' : 'transparent',
            color: activeTab===id ? '#fff' : 'var(--text-secondary)',
            fontFamily:'var(--font-body)', fontWeight:700, fontSize:12,
            transition:'all var(--t-fast)',
          }}>{label}</button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'overview' && (
        <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
          {/* Recent exams */}
          <div style={{ background:'var(--bg-surface)', border:'1px solid var(--border)', borderRadius:'var(--r-xl)', overflow:'hidden' }}>
            <div style={{ padding:'14px 18px', borderBottom:'1px solid var(--border)' }}>
              <h3 style={{ fontSize:'0.9rem' }}>Recent Performance</h3>
            </div>
            {(profile?.recent_exams || []).length === 0 ? (
              <div style={{ padding:'24px', textAlign:'center', color:'var(--text-muted)', fontSize:13 }}>Complete exams to see your history here.</div>
            ) : (
              (profile?.recent_exams || []).map((e, i) => {
                const pct = parseFloat(e.percentage || 0);
                const passed = pct >= 50;
                return (
                  <div key={i} style={{ display:'flex', alignItems:'center', gap:12, padding:'12px 18px', borderBottom:'1px solid var(--border)' }}>
                    <div style={{ width:36, height:36, borderRadius:9, background: passed ? 'var(--success-dim)' : 'var(--danger-dim)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:16, flexShrink:0 }}>
                      {passed ? '✅' : '❌'}
                    </div>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:13, fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{e.title}</div>
                      <div style={{ fontSize:11, color:'var(--text-muted)', marginTop:1 }}>{e.submitted_at ? new Date(e.submitted_at).toLocaleDateString('en-NG') : '—'}</div>
                    </div>
                    <div style={{ textAlign:'right', flexShrink:0 }}>
                      <div style={{ fontFamily:'var(--font-display)', fontSize:16, fontWeight:800, color: passed ? 'var(--success)' : 'var(--danger)' }}>{pct.toFixed(0)}%</div>
                      <div style={{ fontSize:10, color:'var(--text-muted)' }}>{e.score}/{e.exam_total}</div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {activeTab === 'badges' && (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:10 }}>
          {BADGES.map(badge => {
            const earnedData = (profile?.badges || []).find(b => b.badge_id === badge.id);
            return <BadgeCard key={badge.id} badge={badge} earned={!!earnedData} earnedAt={earnedData?.earned_at} />;
          })}
        </div>
      )}

      {activeTab === 'leaderboard' && (
        <Leaderboard data={profile?.leaderboard || []} currentUserId={profile?.id} />
      )}
    </div>
  );
}

export default StudentProfile;
