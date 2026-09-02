import React, { useState, useEffect } from 'react';
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '../../store';
import { ThemeToggle } from '../../components/ThemeProvider';

const NAV = [
  { to: '/admin',           label: 'Dashboard',      icon: '⊞',  end: true },
  { to: '/admin/exams',     label: 'Exams',           icon: '📝' },
  { to: '/admin/questions', label: 'Question Bank',   icon: '🗂' },
  { to: '/admin/candidates',label: 'Candidates',      icon: '👥' },
  { to: '/admin/results',   label: 'Class Results',   icon: '📊' },
  { to: '/admin/essays',    label: 'Essay Grading',   icon: '✍' },
  { to: '/admin/monitor',   label: 'Live Monitor',    icon: '📡' },
  { to: '/admin/analytics', label: 'Analytics',       icon: '📈' },
  { to: '/admin/subjects',  label: 'Subjects',        icon: '📚' },
  { to: '/admin/syllabus',  label: 'Exam Body Manager', icon: '🎓' },
  { to: '/admin/textbooks', label: 'Textbook Library', icon: '📖' },
  { to: '/admin/import',    label: 'Import',          icon: '⬆' },
  { to: '/admin/import/batches', label: 'Import (Reviewed)', icon: '🧾' },
  { to: '/admin/settings',  label: 'Settings',        icon: '⚙' },
];

export default function AdminLayout() {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const notifRef = React.useRef(null);

  // Close mobile drawer on route change
  useEffect(() => { setMobileOpen(false); }, [location.pathname]);

  // Close notification dropdown on outside click
  useEffect(() => {
    if (!notifOpen) return;
    const onClickOutside = (e) => {
      if (notifRef.current && !notifRef.current.contains(e.target)) setNotifOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [notifOpen]);

  const handleLogout = () => { logout(); navigate('/login'); };

  const initials = user?.full_name
    ? user.full_name.split(' ').slice(0,2).map(n => n[0]).join('').toUpperCase()
    : 'A';

  const SidebarContent = () => (
    <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>
      {/* Logo */}
      <div style={{
        display:'flex', alignItems:'center', justifyContent: collapsed ? 'center' : 'space-between',
        padding: collapsed ? '20px 0' : '20px 16px',
        borderBottom: '1px solid var(--border)',
        flexShrink: 0,
      }}>
        {!collapsed && (
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <div style={{
              width:32, height:32, borderRadius:10,
              background:'linear-gradient(135deg, var(--brand-dark), var(--brand-light))',
              display:'flex', alignItems:'center', justifyContent:'center',
              fontSize:16, fontWeight:900, color:'#fff', flexShrink:0,
              boxShadow:'0 2px 12px var(--brand-glow)',
            }}>E</div>
            <div>
              <div style={{ fontFamily:'var(--font-display)', fontSize:15, fontWeight:800, letterSpacing:'-0.02em', lineHeight:1 }}>Examora</div>
              <div style={{ fontSize:10, color:'var(--text-muted)', fontWeight:500, marginTop:2 }}>2.0 Admin</div>
            </div>
          </div>
        )}
        {collapsed && (
          <div style={{
            width:32, height:32, borderRadius:10,
            background:'linear-gradient(135deg, var(--brand-dark), var(--brand-light))',
            display:'flex', alignItems:'center', justifyContent:'center',
            fontSize:16, fontWeight:900, color:'#fff',
          }}>E</div>
        )}
        <button
          onClick={() => setCollapsed(c => !c)}
          className="desktop-only"
          style={{ background:'none', border:'none', cursor:'pointer', color:'var(--text-muted)', fontSize:16, padding:4, borderRadius:6, transition:'color var(--t-fast)', flexShrink:0 }}
          onMouseOver={e => e.currentTarget.style.color='var(--text-primary)'}
          onMouseOut={e => e.currentTarget.style.color='var(--text-muted)'}
        >
          {collapsed ? '→' : '←'}
        </button>
      </div>

      {/* Navigation */}
      <nav style={{ flex:1, padding:'8px 0', overflowY:'auto', display:'flex', flexDirection:'column' }}>
        {NAV.map(item => (
          <NavLink key={item.to} to={item.to} end={item.end}
            style={({ isActive }) => ({
              display:'flex', alignItems:'center',
              width: collapsed ? 'auto' : 'calc(100% - 16px)',
              boxSizing:'border-box',
              gap: collapsed ? 0 : 10,
              justifyContent: collapsed ? 'center' : 'flex-start',
              padding: collapsed ? '10px 0' : '9px 16px',
              margin: '1px 8px',
              borderRadius: 'var(--r)',
              textDecoration:'none',
              fontSize:13, fontWeight:600,
              color: isActive ? 'var(--brand-light)' : 'var(--text-secondary)',
              background: isActive ? 'var(--brand-dim)' : 'transparent',
              transition:'all var(--t-fast)',
              flexShrink:0,
            })}
            onMouseOver={e => { if (e.currentTarget.getAttribute('aria-current') !== 'page') { e.currentTarget.style.background = 'var(--bg-raised)'; e.currentTarget.style.color = 'var(--text-primary)'; }}}
            onMouseOut={e => { if (e.currentTarget.getAttribute('aria-current') !== 'page') { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-secondary)'; }}}
          >
            <span style={{ fontSize:16, flexShrink:0, width:20, textAlign:'center' }}>{item.icon}</span>
            {!collapsed && <span style={{ whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{item.label}</span>}
          </NavLink>
        ))}
      </nav>

      {/* User section */}
      <div style={{
        borderTop:'1px solid var(--border)',
        padding: collapsed ? '12px 0' : '12px 16px',
        flexShrink: 0,
      }}>
        {!collapsed ? (
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <div style={{
              width:34, height:34, borderRadius:'50%',
              background:'var(--brand-dim)',
              display:'flex', alignItems:'center', justifyContent:'center',
              fontFamily:'var(--font-display)', fontSize:13, fontWeight:800, color:'var(--brand-light)',
              flexShrink:0,
            }}>{initials}</div>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:12, fontWeight:700, truncate:true, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                {user?.full_name?.split(' ')[0] || 'Admin'}
              </div>
              <div style={{ fontSize:10, color:'var(--text-muted)', marginTop:1 }}>{user?.role || 'admin'}</div>
            </div>
            <button onClick={handleLogout} title="Logout" style={{
              background:'none', border:'none', cursor:'pointer', color:'var(--text-muted)',
              fontSize:14, padding:5, borderRadius:6, transition:'color var(--t-fast)', flexShrink:0,
            }}
              onMouseOver={e => e.currentTarget.style.color='var(--danger)'}
              onMouseOut={e => e.currentTarget.style.color='var(--text-muted)'}
            >⎋</button>
          </div>
        ) : (
          <div style={{ display:'flex', justifyContent:'center' }}>
            <div style={{
              width:32, height:32, borderRadius:'50%',
              background:'var(--brand-dim)',
              display:'flex', alignItems:'center', justifyContent:'center',
              fontFamily:'var(--font-display)', fontSize:12, fontWeight:800, color:'var(--brand-light)',
              cursor:'pointer',
            }} onClick={handleLogout} title="Logout">{initials}</div>
          </div>
        )}
      </div>
    </div>
  );

  const sideW = collapsed ? 60 : 220;

  return (
    <div style={{ display:'flex', minHeight:'100dvh', background:'var(--bg-base)' }}>

      {/* Desktop Sidebar */}
      <aside className="desktop-only" style={{
        width: sideW,
        flexShrink: 0,
        background: 'var(--bg-surface)',
        borderRight: '1px solid var(--border)',
        position: 'sticky', top: 0, height: '100dvh',
        transition: 'width var(--t-base)',
        overflow: 'hidden',
        zIndex: 40,
      }}>
        <SidebarContent />
      </aside>

      {/* Mobile drawer overlay */}
      {mobileOpen && (
        <div
          className="mobile-only"
          onClick={() => setMobileOpen(false)}
          style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', backdropFilter:'blur(4px)', zIndex:199 }}
        />
      )}

      {/* Mobile drawer */}
      <aside className="mobile-only" style={{
        position: 'fixed', top:0, left:0, bottom:0,
        width: 240,
        background: 'var(--bg-surface)',
        borderRight: '1px solid var(--border-md)',
        zIndex: 200,
        transform: mobileOpen ? 'translateX(0)' : 'translateX(-100%)',
        transition: 'transform var(--t-base)',
        boxShadow: mobileOpen ? 'var(--shadow-xl)' : 'none',
      }}>
        <SidebarContent />
      </aside>

      {/* Main content */}
      <div style={{ flex:1, display:'flex', flexDirection:'column', minWidth:0, overflow:'hidden' }}>

        {/* Top bar */}
        <header style={{
          height: 56,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 24px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--bg-glass)',
          backdropFilter: 'blur(12px)',
          position: 'sticky', top: 0, zIndex: 30,
          flexShrink: 0,
        }}>
          {/* Mobile hamburger */}
          <button className="mobile-only" onClick={() => setMobileOpen(true)} style={{
            background:'none', border:'none', cursor:'pointer', color:'var(--text-secondary)',
            fontSize:20, padding:4, borderRadius:8, display:'flex', alignItems:'center',
          }}>☰</button>

          {/* Breadcrumb / page title */}
          <div className="desktop-only" style={{ fontSize:13, color:'var(--text-muted)', display:'flex', alignItems:'center', gap:6 }}>
            <span style={{ color:'var(--brand-light)', fontWeight:600 }}>Examora</span>
            <span>/</span>
            <span style={{ color:'var(--text-secondary)' }}>
              {NAV.find(n => n.end ? location.pathname === n.to : location.pathname.startsWith(n.to))?.label || 'Admin'}
            </span>
          </div>

          {/* Mobile logo */}
          <div className="mobile-only" style={{ display:'flex', alignItems:'center', gap:8 }}>
            <div style={{ width:26, height:26, borderRadius:8, background:'linear-gradient(135deg,var(--brand-dark),var(--brand-light))', display:'flex', alignItems:'center', justifyContent:'center', fontSize:13, fontWeight:900, color:'#fff' }}>E</div>
            <span style={{ fontFamily:'var(--font-display)', fontSize:15, fontWeight:800 }}>Examora</span>
          </div>

          <div style={{ display:'flex', alignItems:'center', gap:12 }}>
            <ThemeToggle size="sm" />

            {/* Notifications */}
            <div ref={notifRef} style={{ position:'relative' }}>
              <button
                onClick={() => setNotifOpen(o => !o)}
                aria-label="Notifications"
                style={{
                  width:34, height:34, borderRadius:'var(--r)',
                  border:'1px solid var(--border-md)',
                  background: notifOpen ? 'var(--bg-overlay)' : 'var(--bg-raised)',
                  color:'var(--text-secondary)',
                  cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center',
                  fontSize:15, transition:'all var(--t-fast)', position:'relative',
                }}
                onMouseOver={e => { if (!notifOpen) e.currentTarget.style.background='var(--bg-overlay)'; }}
                onMouseOut={e => { if (!notifOpen) e.currentTarget.style.background='var(--bg-raised)'; }}
              >
                🔔
                {notifications.some(n => !n.read) && (
                  <span style={{
                    position:'absolute', top:4, right:4,
                    width:7, height:7, borderRadius:'50%',
                    background:'var(--brand)', border:'2px solid var(--bg-raised)',
                  }}/>
                )}
              </button>

              {notifOpen && (
                <div style={{
                  position:'absolute', top:'calc(100% + 10px)', right:0,
                  width:320, maxWidth:'85vw',
                  background:'var(--bg-surface)', border:'1px solid var(--border-md)',
                  borderRadius:'var(--r-lg)', boxShadow:'var(--shadow-lg)',
                  zIndex:50, overflow:'hidden',
                }}>
                  <div style={{
                    padding:'14px 16px', borderBottom:'1px solid var(--border)',
                    display:'flex', alignItems:'center', justifyContent:'space-between',
                  }}>
                    <span style={{ fontWeight:700, fontSize:13.5, color:'var(--text-primary)' }}>Notifications</span>
                    {notifications.some(n => !n.read) && (
                      <button
                        onClick={() => setNotifications(ns => ns.map(n => ({ ...n, read: true })))}
                        style={{ background:'none', border:'none', color:'var(--brand-light)', fontSize:12, fontWeight:600, cursor:'pointer' }}
                      >
                        Mark all read
                      </button>
                    )}
                  </div>
                  <div style={{ maxHeight:320, overflowY:'auto' }}>
                    {notifications.length === 0 ? (
                      <div style={{ padding:'28px 16px', textAlign:'center', color:'var(--text-muted)', fontSize:13 }}>
                        No notifications yet
                      </div>
                    ) : notifications.map(n => (
                      <div
                        key={n.id}
                        onClick={() => { setNotifications(ns => ns.map(x => x.id === n.id ? { ...x, read: true } : x)); if (n.to) { navigate(n.to); setNotifOpen(false); } }}
                        style={{
                          padding:'12px 16px', borderBottom:'1px solid var(--border)',
                          cursor: n.to ? 'pointer' : 'default',
                          background: n.read ? 'transparent' : 'var(--brand-dim)',
                          transition:'background var(--t-fast)',
                        }}
                        onMouseOver={e => e.currentTarget.style.background = n.read ? 'var(--bg-raised)' : 'var(--brand-dim)'}
                        onMouseOut={e => e.currentTarget.style.background = n.read ? 'transparent' : 'var(--brand-dim)'}
                      >
                        <div style={{ display:'flex', gap:10 }}>
                          <span style={{ fontSize:16, flexShrink:0 }}>{n.icon || 'ℹ️'}</span>
                          <div style={{ minWidth:0 }}>
                            <div style={{ fontSize:13, fontWeight:600, color:'var(--text-primary)' }}>{n.title}</div>
                            <div style={{ fontSize:12, color:'var(--text-secondary)', marginTop:2 }}>{n.body}</div>
                            <div style={{ fontSize:11, color:'var(--text-muted)', marginTop:4 }}>{n.time}</div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Page content */}
        <main style={{ flex:1, overflow:'auto', paddingBottom:72 }}>
          <Outlet />
        </main>
      </div>

      {/* Mobile bottom nav */}
      <nav className="mobile-nav mobile-only">
        <div className="mobile-nav-inner">
          {NAV.slice(0,5).map(item => {
            const isActive = item.end ? location.pathname === item.to : location.pathname.startsWith(item.to);
            return (
              <button key={item.to}
                onClick={() => navigate(item.to)}
                className={`mobile-nav-item ${isActive ? 'active' : ''}`}
              >
                <span className="mobile-nav-icon">{item.icon}</span>
                <span>{item.label.split(' ')[0]}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
