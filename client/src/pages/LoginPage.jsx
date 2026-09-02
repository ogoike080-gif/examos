import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import axios from 'axios';
import { useAuthStore } from '../store';
import { ThemeToggle } from '../components/ThemeProvider';

const API = '/api';

export default function LoginPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [showStaff, setShowStaff] = useState(false);
  const [staffMode, setStaffMode] = useState('staffid');
  const [mounted, setMounted] = useState(false);

  // Student fields
  const [surname, setSurname] = useState('');
  const [regNumber, setRegNumber] = useState('');
  const [needsReg, setNeedsReg] = useState(false);

  // Staff ID fields
  const [staffId, setStaffId] = useState('');
  const [staffSurname, setStaffSurname] = useState('');

  // Email fields
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  const doLogin = async (payload) => {
    const res = await axios.post(`${API}/auth/login`, payload);
    const { token, user } = res.data;
    axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    useAuthStore.setState({ user, token, isAuthenticated: true });
    navigate(user.role === 'candidate' ? '/exam' : user.role === 'parent' ? '/parent' : '/admin');
  };

  const handleStudentSubmit = async (e) => {
    e.preventDefault();
    if (!surname.trim()) { toast.error('Enter your surname'); return; }
    setLoading(true);
    try {
      const payload = { surname: surname.trim() };
      if (needsReg) {
        if (!regNumber.trim()) { toast.error('Enter your registration number'); setLoading(false); return; }
        payload.reg_number = regNumber.trim();
      }
      await doLogin(payload);
      toast.success('Welcome back!');
    } catch (err) {
      if (err.response?.data?.requires_reg_number) {
        setNeedsReg(true);
        toast.error('Same surname found — please enter your registration number too.');
      } else {
        toast.error(err.response?.data?.error || 'Login failed');
      }
    } finally { setLoading(false); }
  };

  const handleStaffIdSubmit = async (e) => {
    e.preventDefault();
    if (!staffId.trim()) { toast.error('Enter your Staff ID'); return; }
    setLoading(true);
    try {
      const payload = { staff_id: staffId.trim() };
      if (staffSurname.trim()) payload.surname = staffSurname.trim();
      await doLogin(payload);
      toast.success('Welcome back!');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Login failed');
    } finally { setLoading(false); }
  };

  const handleEmailSubmit = async (e) => {
    e.preventDefault();
    if (!email || !password) { toast.error('Enter email and password'); return; }
    setLoading(true);
    try {
      await doLogin({ email, password });
      toast.success('Welcome back!');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Login failed');
    } finally { setLoading(false); }
  };

  return (
    <div style={{
      minHeight: '100dvh',
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--bg-base)',
      position: 'relative',
      overflow: 'hidden',
    }}>

      {/* Ambient background orbs */}
      <div style={{
        position:'absolute', top:'-20%', left:'-10%',
        width:'60vw', height:'60vw', maxWidth:600, maxHeight:600,
        background:'radial-gradient(circle, rgba(99,102,241,0.12) 0%, transparent 70%)',
        pointerEvents:'none', zIndex:0,
      }}/>
      <div style={{
        position:'absolute', bottom:'-10%', right:'-5%',
        width:'50vw', height:'50vw', maxWidth:500, maxHeight:500,
        background:'radial-gradient(circle, rgba(167,139,250,0.08) 0%, transparent 70%)',
        pointerEvents:'none', zIndex:0,
      }}/>

      {/* Header */}
      <header style={{
        display:'flex', alignItems:'center', justifyContent:'space-between',
        padding:'16px 24px',
        position:'relative', zIndex:1,
      }}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <div style={{
            width:34, height:34, borderRadius:10,
            background:'linear-gradient(135deg, var(--brand-dark), var(--brand-light))',
            display:'flex', alignItems:'center', justifyContent:'center',
            fontSize:17, fontWeight:900, color:'#fff',
            boxShadow:'0 2px 12px var(--brand-glow)',
          }}>E</div>
          <div>
            <div style={{ fontFamily:'var(--font-display)', fontSize:16, fontWeight:800, letterSpacing:'-0.02em', lineHeight:1 }}>Examora</div>
            <div style={{ fontSize:10, color:'var(--text-muted)', fontWeight:500 }}>2.0 · CBT Platform</div>
          </div>
        </div>
        <ThemeToggle />
      </header>

      {/* Main */}
      <main style={{
        flex:1, display:'flex', alignItems:'center', justifyContent:'center',
        padding:'24px 16px 40px',
        position:'relative', zIndex:1,
      }}>
        <div style={{
          width:'100%', maxWidth:420,
          animation: mounted ? 'fadeInUp 0.4s cubic-bezier(0.4,0,0.2,1) both' : 'none',
        }}>

          {!showStaff ? (
            /* ── STUDENT LOGIN ── */
            <>
              <div style={{ textAlign:'center', marginBottom:32 }}>
                <div style={{ fontSize:40, marginBottom:12 }}>🎓</div>
                <h1 style={{ fontSize:'1.6rem', marginBottom:8 }}>Student Login</h1>
                <p style={{ fontSize:14, color:'var(--text-muted)' }}>Enter your surname to begin your exam</p>
              </div>

              <div className="glass" style={{ padding:28 }}>
                <form onSubmit={handleStudentSubmit}>
                  <div style={{ marginBottom:20 }}>
                    <label className="label">Your Surname</label>
                    <input
                      type="text"
                      placeholder="e.g. Okonkwo"
                      value={surname}
                      onChange={e => { setSurname(e.target.value); setNeedsReg(false); setRegNumber(''); }}
                      style={{ textAlign:'center', fontSize:20, fontWeight:700, letterSpacing:'0.02em' }}
                      autoFocus autoComplete="family-name" required
                    />
                    <p style={{ fontSize:11, color:'var(--text-muted)', textAlign:'center', marginTop:6 }}>
                      Enter your surname exactly as your teacher registered you
                    </p>
                  </div>

                  {needsReg && (
                    <div style={{ marginBottom:20, animation:'scaleIn 0.25s cubic-bezier(0.34,1.56,0.64,1)' }}>
                      <label className="label">Registration Number</label>
                      <input
                        type="text" inputMode="numeric" maxLength={9}
                        placeholder="202300001"
                        value={regNumber}
                        onChange={e => setRegNumber(e.target.value.replace(/\D/g,'').slice(0,9))}
                        style={{ fontFamily:'var(--font-mono)', fontSize:20, letterSpacing:'0.2em', textAlign:'center', fontWeight:700 }}
                        autoFocus required
                      />
                      <p style={{ fontSize:11, color:'var(--warning)', textAlign:'center', marginTop:6 }}>
                        Another student has the same surname
                      </p>
                    </div>
                  )}

                  <button type="submit" className="btn btn-primary w-full btn-lg" disabled={loading}>
                    {loading ? <><span className="spinner"/> Signing in...</> : 'Start Exam →'}
                  </button>
                </form>
              </div>

              <div style={{ textAlign:'center', marginTop:20 }}>
                <button type="button" onClick={() => setShowStaff(true)}
                  style={{ background:'none', border:'none', cursor:'pointer', fontSize:12, color:'var(--text-muted)', fontFamily:'var(--font-body)', textDecoration:'underline', textUnderlineOffset:3 }}>
                  Staff / Admin login
                </button>
              </div>
            </>
          ) : (
            /* ── STAFF LOGIN ── */
            <>
              <div style={{ textAlign:'center', marginBottom:32 }}>
                <div style={{ fontSize:40, marginBottom:12 }}>🔑</div>
                <h1 style={{ fontSize:'1.6rem', marginBottom:8 }}>Staff Login</h1>
                <p style={{ fontSize:14, color:'var(--text-muted)' }}>Login with your Staff ID or email</p>
              </div>

              <div className="glass" style={{ padding:28 }}>
                {/* Mode tabs */}
                <div style={{
                  display:'flex', background:'var(--bg-raised)',
                  borderRadius:'var(--r)', padding:4, marginBottom:24,
                  border:'1px solid var(--border)',
                }}>
                  {[['staffid','🪪 Staff ID'],['email','📧 Email']].map(([mode,label]) => (
                    <button key={mode} type="button" onClick={() => setStaffMode(mode)} style={{
                      flex:1, padding:'8px 12px', border:'none', borderRadius:'var(--r-sm)', cursor:'pointer',
                      background: staffMode===mode ? 'var(--brand)' : 'transparent',
                      color: staffMode===mode ? '#fff' : 'var(--text-secondary)',
                      fontFamily:'var(--font-body)', fontWeight:700, fontSize:13,
                      transition:'all var(--t-fast)',
                    }}>{label}</button>
                  ))}
                </div>

                {staffMode === 'staffid' ? (
                  <form onSubmit={handleStaffIdSubmit}>
                    <div style={{ marginBottom:16 }}>
                      <label className="label">Staff ID</label>
                      <input
                        type="text"
                        placeholder="e.g. OGT-STAFF-001"
                        value={staffId}
                        onChange={e => setStaffId(e.target.value)}
                        style={{ fontFamily:'var(--font-mono)', fontSize:16, letterSpacing:'0.06em', textAlign:'center', fontWeight:700 }}
                        autoFocus autoComplete="off" required
                      />
                    </div>
                    <div style={{ marginBottom:20 }}>
                      <label className="label">Surname <span style={{ textTransform:'none', fontWeight:400, color:'var(--text-dim)' }}>(optional)</span></label>
                      <input type="text" placeholder="e.g. Obi" value={staffSurname} onChange={e => setStaffSurname(e.target.value)} autoComplete="family-name" />
                    </div>
                    <button type="submit" className="btn btn-primary w-full btn-lg" disabled={loading}>
                      {loading ? <><span className="spinner"/> Signing in...</> : 'Sign In →'}
                    </button>
                  </form>
                ) : (
                  <form onSubmit={handleEmailSubmit}>
                    <div style={{ marginBottom:16 }}>
                      <label className="label">Email Address</label>
                      <input type="email" placeholder="staff@ogotech.edu.ng" value={email} onChange={e => setEmail(e.target.value)} autoFocus autoComplete="email" required />
                    </div>
                    <div style={{ marginBottom:20, position:'relative' }}>
                      <label className="label">Password</label>
                      <input
                        type={showPass ? 'text' : 'password'}
                        placeholder="••••••••" value={password}
                        onChange={e => setPassword(e.target.value)}
                        autoComplete="current-password" required
                        style={{ paddingRight:44 }}
                      />
                      <button type="button" onClick={() => setShowPass(s => !s)} style={{
                        position:'absolute', right:12, bottom:10,
                        background:'none', border:'none', cursor:'pointer',
                        color:'var(--text-muted)', fontSize:15,
                      }}>{showPass ? '🙈' : '👁'}</button>
                    </div>
                    <button type="submit" className="btn btn-primary w-full btn-lg" disabled={loading}>
                      {loading ? <><span className="spinner"/> Signing in...</> : 'Sign In →'}
                    </button>
                  </form>
                )}
              </div>

              <div style={{ textAlign:'center', marginTop:20 }}>
                <button type="button" onClick={() => setShowStaff(false)}
                  style={{ background:'none', border:'none', cursor:'pointer', fontSize:12, color:'var(--text-muted)', fontFamily:'var(--font-body)', textDecoration:'underline', textUnderlineOffset:3 }}>
                  ← Back to student login
                </button>
              </div>
            </>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer style={{ textAlign:'center', padding:'16px 24px', position:'relative', zIndex:1 }}>
        <p style={{ fontSize:11, color:'var(--text-dim)' }}>
          Ogotech Conventional/Technical School · Examora · 2026
        </p>
      </footer>
    </div>
  );
}
