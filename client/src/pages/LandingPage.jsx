import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ThemeToggle } from '../components/ThemeProvider';

const STATS = [
  { val:'10,000+', label:'Students',    icon:'👥' },
  { val:'50,000+', label:'Questions',   icon:'📚' },
  { val:'500+',    label:'Schools',     icon:'🏫' },
  { val:'98%',     label:'Pass Rate',   icon:'🎯' },
];

const FEATURES = [
  { icon:'🤖', title:'AI Study Assistant',     desc:'Get instant explanations, hints, and personalized study plans powered by Claude AI.' },
  { icon:'⚡', title:'Lightning Fast Engine',  desc:'Questions load instantly. No page reloads. Auto-save. Resume after network failure.' },
  { icon:'📊', title:'Deep Analytics',         desc:'Track your performance, identify weak areas, and see your improvement over time.' },
  { icon:'🏆', title:'Gamification',           desc:'Earn XP, unlock badges, maintain streaks, and compete on the leaderboard.' },
  { icon:'📱', title:'Mobile First',           desc:'Works perfectly on any device. Install as an app for offline exam practice.' },
  { icon:'🎓', title:'All Nigerian Exams',     desc:'WAEC, JAMB, NECO, NABTEB, Post-UTME, and custom school exams supported.' },
];

const SUBJECTS = [
  { name:'Mathematics',         icon:'📐', color:'#6366F1' },
  { name:'English Language',    icon:'📝', color:'#10B981' },
  { name:'Physics',             icon:'⚛️',  color:'#3B82F6' },
  { name:'Chemistry',           icon:'🧪', color:'#EF4444' },
  { name:'Biology',             icon:'🧬', color:'#22C55E' },
  { name:'Economics',           icon:'📈', color:'#F59E0B' },
  { name:'Government',          icon:'🏛️',  color:'#8B5CF6' },
  { name:'Literature',          icon:'📖', color:'#EC4899' },
  { name:'Geography',           icon:'🌍', color:'#06B6D4' },
  { name:'Computer Science',    icon:'💻', color:'#6366F1' },
  { name:'Accounting',          icon:'🧮', color:'#F97316' },
  { name:'Agricultural Science',icon:'🌾', color:'#84CC16' },
];

export default function LandingPage() {
  const navigate = useNavigate();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 60);
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div style={{ minHeight:'100dvh', background:'var(--bg-base)', overflowX:'hidden' }}>

      {/* ── NAVBAR ── */}
      <nav style={{
        position:'fixed', top:0, left:0, right:0, zIndex:100,
        height:60, display:'flex', alignItems:'center', justifyContent:'space-between',
        padding:'0 24px',
        background: scrolled ? 'var(--bg-glass)' : 'transparent',
        backdropFilter: scrolled ? 'blur(20px)' : 'none',
        WebkitBackdropFilter: scrolled ? 'blur(20px)' : 'none',
        borderBottom: scrolled ? '1px solid var(--border)' : 'none',
        transition:'all 0.3s ease',
      }}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <div style={{ width:32, height:32, borderRadius:9, background:'linear-gradient(135deg,#4F46E5,#818CF8)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:16, fontWeight:900, color:'#fff', boxShadow:'0 2px 10px rgba(99,102,241,0.4)' }}>E</div>
          <span style={{ fontFamily:'var(--font-display)', fontSize:16, fontWeight:800, letterSpacing:'-0.02em' }}>ExamOS</span>
          <span style={{ fontSize:10, background:'var(--brand-dim)', color:'var(--brand-light)', padding:'2px 8px', borderRadius:'var(--r-full)', fontWeight:700, letterSpacing:'0.04em' }}>2.0</span>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <button onClick={() => navigate('/study')} className="btn btn-ghost btn-sm" style={{ fontSize:13 }}>Practice Free</button>
          <ThemeToggle size="sm" />
          <button onClick={() => navigate('/login')} className="btn btn-primary btn-sm">Login</button>
        </div>
      </nav>

     

      {/* ── HERO ── */}
      <section style={{
        minHeight:'100dvh', display:'flex', flexDirection:'column',
        alignItems:'center', justifyContent:'center',
        padding:'80px 24px 60px',
        position:'relative', textAlign:'center',
        background:'radial-gradient(ellipse at 50% 0%, rgba(99,102,241,0.15) 0%, transparent 60%)',
      }}>
        {/* Floating orbs */}
        <div style={{ position:'absolute', top:'15%', left:'8%', width:300, height:300, background:'radial-gradient(circle, rgba(99,102,241,0.12), transparent)', borderRadius:'50%', pointerEvents:'none', animation:'float 6s ease-in-out infinite' }}/>
        <div style={{ position:'absolute', bottom:'20%', right:'5%', width:250, height:250, background:'radial-gradient(circle, rgba(167,139,250,0.1), transparent)', borderRadius:'50%', pointerEvents:'none', animation:'float 8s ease-in-out infinite reverse' }}/>

        <div style={{ animation:'fadeInUp 0.6s both', position:'relative', zIndex:1 }}>
          <div style={{ display:'inline-flex', alignItems:'center', gap:8, padding:'6px 16px', borderRadius:'var(--r-full)', background:'var(--brand-dim)', border:'1px solid rgba(99,102,241,0.3)', marginBottom:24 }}>
            <span style={{ fontSize:14 }}>🚀</span>
            <span style={{ fontSize:12, fontWeight:700, color:'var(--brand-light)', letterSpacing:'0.04em' }}>Nigeria's Most Advanced CBT Platform</span>
          </div>

          <h1 style={{ fontSize:'clamp(2.2rem,6vw,4rem)', fontWeight:900, letterSpacing:'-0.04em', lineHeight:1.05, marginBottom:20, maxWidth:700 }}>
            Ace Your Exams with{' '}
            <span style={{ background:'linear-gradient(135deg,#6366F1,#A78BFA,#60A5FA)', WebkitBackgroundClip:'text', WebkitTextFillColor:'transparent', backgroundClip:'text' }}>
              AI-Powered
            </span>{' '}
            Practice
          </h1>

          <p style={{ fontSize:'clamp(1rem,2.5vw,1.2rem)', color:'var(--text-secondary)', maxWidth:560, margin:'0 auto 36px', lineHeight:1.7 }}>
            Practice WAEC, JAMB, NECO & more. Get instant AI explanations, track your progress, and compete on the leaderboard.
          </p>

          <div style={{ display:'flex', gap:12, justifyContent:'center', flexWrap:'wrap', marginBottom:48 }}>
            <button onClick={() => navigate('/study')} className="btn btn-primary btn-xl" style={{ fontSize:16, gap:10 }}>
              🎯 Start Practicing Free
            </button>
            <button onClick={() => navigate('/login')} className="btn btn-secondary btn-xl" style={{ fontSize:16 }}>
              Login to Dashboard
            </button>
          </div>

          {/* Stats */}
          <div style={{ display:'flex', gap:32, justifyContent:'center', flexWrap:'wrap' }}>
            {STATS.map(s => (
              <div key={s.label} style={{ textAlign:'center' }}>
                <div style={{ fontFamily:'var(--font-display)', fontSize:'1.6rem', fontWeight:900, color:'var(--brand-light)', letterSpacing:'-0.03em' }}>{s.val}</div>
                <div style={{ fontSize:12, color:'var(--text-muted)', marginTop:2 }}>{s.icon} {s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── SUBJECTS ── */}
      <section style={{ padding:'80px 24px', background:'var(--bg-surface)' }}>
        <div style={{ maxWidth:1100, margin:'0 auto' }}>
          <div style={{ textAlign:'center', marginBottom:48 }}>
            <h2 style={{ fontSize:'clamp(1.6rem,4vw,2.4rem)', marginBottom:12 }}>All Subjects Covered</h2>
            <p style={{ color:'var(--text-muted)', fontSize:15 }}>Practice with thousands of past questions across all subjects</p>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(160px,1fr))', gap:12 }}>
            {SUBJECTS.map(sub => (
              <button key={sub.name} onClick={() => navigate(`/practice?subject=${encodeURIComponent(sub.name)}`)}
                style={{
                  background:'var(--bg-raised)', border:'1px solid var(--border)',
                  borderRadius:'var(--r-xl)', padding:'20px 16px', textAlign:'center',
                  cursor:'pointer', transition:'all var(--t-base)',
                  fontFamily:'var(--font-body)',
                }}
                onMouseOver={e => { e.currentTarget.style.borderColor=sub.color; e.currentTarget.style.transform='translateY(-3px)'; e.currentTarget.style.boxShadow=`0 8px 24px ${sub.color}22`; }}
                onMouseOut={e => { e.currentTarget.style.borderColor='var(--border)'; e.currentTarget.style.transform=''; e.currentTarget.style.boxShadow=''; }}
              >
                <div style={{ fontSize:28, marginBottom:10 }}>{sub.icon}</div>
                <div style={{ fontSize:12, fontWeight:700, color:'var(--text-primary)', lineHeight:1.3 }}>{sub.name}</div>
              </button>
            ))}
          </div>
        </div>
      </section>

    

      {/* ── FEATURES ── */}
      <section style={{ padding:'80px 24px' }}>
        <div style={{ maxWidth:1100, margin:'0 auto' }}>
          <div style={{ textAlign:'center', marginBottom:48 }}>
            <h2 style={{ fontSize:'clamp(1.6rem,4vw,2.4rem)', marginBottom:12 }}>Why ExamOS?</h2>
            <p style={{ color:'var(--text-muted)', fontSize:15 }}>Built for Nigerian students, by Nigerian educators</p>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(300px,1fr))', gap:16 }}>
            {FEATURES.map((f, i) => (
              <div key={f.title} className="card" style={{ animation:`fadeInUp 0.4s ${i*0.07}s both` }}>
                <div style={{ fontSize:32, marginBottom:14 }}>{f.icon}</div>
                <h3 style={{ fontSize:'1rem', marginBottom:8 }}>{f.title}</h3>
                <p style={{ fontSize:13, color:'var(--text-muted)', lineHeight:1.7 }}>{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section style={{ padding:'80px 24px', background:'linear-gradient(135deg,var(--brand-dark),var(--brand))', textAlign:'center', position:'relative', overflow:'hidden' }}>
        <div style={{ position:'absolute', top:-60, right:-60, width:300, height:300, borderRadius:'50%', background:'rgba(255,255,255,0.05)', pointerEvents:'none' }}/>
        <div style={{ position:'relative', zIndex:1 }}>
          <h2 style={{ fontSize:'clamp(1.6rem,4vw,2.6rem)', color:'#fff', marginBottom:12 }}>Ready to Ace Your Exams?</h2>
          <p style={{ color:'rgba(255,255,255,0.75)', fontSize:15, marginBottom:32, maxWidth:500, margin:'0 auto 32px' }}>
            Join thousands of Nigerian students already using ExamOS to prepare smarter and score higher.
          </p>
          <div style={{ display:'flex', gap:12, justifyContent:'center', flexWrap:'wrap' }}>
            <button onClick={() => navigate('/study')} style={{ padding:'14px 32px', borderRadius:'var(--r-lg)', background:'#fff', color:'var(--brand-dark)', border:'none', fontWeight:800, fontSize:15, cursor:'pointer', fontFamily:'var(--font-body)', transition:'all 0.15s' }}
              onMouseOver={e => e.currentTarget.style.transform='translateY(-2px)'}
              onMouseOut={e => e.currentTarget.style.transform=''}
            >Start Free Practice →</button>
            <button onClick={() => navigate('/login')} style={{ padding:'14px 32px', borderRadius:'var(--r-lg)', background:'transparent', color:'#fff', border:'2px solid rgba(255,255,255,0.5)', fontWeight:700, fontSize:15, cursor:'pointer', fontFamily:'var(--font-body)', transition:'all 0.15s' }}
              onMouseOver={e => e.currentTarget.style.borderColor='#fff'}
              onMouseOut={e => e.currentTarget.style.borderColor='rgba(255,255,255,0.5)'}
            >School Login</button>
          </div>
        </div>
      </section>
       

      {/* ── FOOTER ── */}
      <footer style={{ padding:'32px 24px', textAlign:'center', borderTop:'1px solid var(--border)', background:'var(--bg-surface)' }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:10, marginBottom:12 }}>
          <div style={{ width:28, height:28, borderRadius:8, background:'linear-gradient(135deg,#4F46E5,#818CF8)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:13, fontWeight:900, color:'#fff' }}>E</div>
          <span style={{ fontFamily:'var(--font-display)', fontWeight:800, fontSize:15 }}>ExamOS 2.0</span>
        </div>
        <p style={{ fontSize:12, color:'var(--text-muted)' }}>
          Built with ❤️ for Nigerian students · Ogotech Technologies · 2026
        </p>
      </footer>
    </div>
  );
}
