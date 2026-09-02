import React, { useState, useEffect } from 'react';

// ── usePWA hook — inlined here to avoid import path issues ────
function usePWA() {
  const [installPrompt, setInstallPrompt] = useState(null);
  const [isInstalled, setIsInstalled]     = useState(false);
  const [isOnline, setIsOnline]           = useState(navigator.onLine);
  const [updateAvailable, setUpdateAvailable] = useState(false);

  useEffect(() => {
    const onPrompt = (e) => { e.preventDefault(); setInstallPrompt(e); };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', () => setIsInstalled(true));
    if (window.matchMedia('(display-mode: standalone)').matches) setIsInstalled(true);

    const goOnline  = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener('online',  goOnline);
    window.addEventListener('offline', goOffline);

    const onUpdate = () => setUpdateAvailable(true);
    window.addEventListener('sw-update-available', onUpdate);

    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('online',  goOnline);
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('sw-update-available', onUpdate);
    };
  }, []);

  const install = async () => {
    if (!installPrompt) return false;
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === 'accepted') setIsInstalled(true);
    setInstallPrompt(null);
    return outcome === 'accepted';
  };

  const applyUpdate = () => {
    navigator.serviceWorker?.getRegistration().then(reg => {
      reg?.waiting?.postMessage({ type: 'SKIP_WAITING' });
      window.location.reload();
    });
  };

  return { installPrompt, isInstalled, isOnline, updateAvailable, install, applyUpdate };
}

// ── Install Banner ────────────────────────────────────────────
export function InstallBanner() {
  const { installPrompt, isInstalled, install } = usePWA();
  const [dismissed, setDismissed] = useState(
    () => { try { return localStorage.getItem('pwa-dismissed') === '1'; } catch { return false; } }
  );

  if (!installPrompt || isInstalled || dismissed) return null;

  const handleDismiss = () => {
    setDismissed(true);
    try { localStorage.setItem('pwa-dismissed', '1'); } catch {}
  };

  return (
    <div style={{
      position:'fixed', bottom:72, left:12, right:12,
      background:'var(--bg-glass)',
      backdropFilter:'blur(20px)', WebkitBackdropFilter:'blur(20px)',
      border:'1px solid var(--border-md)',
      borderRadius:'var(--r-xl)', padding:'14px 16px',
      display:'flex', alignItems:'center', gap:12,
      boxShadow:'var(--shadow-xl)', zIndex:200,
      animation:'fadeInUp 0.4s cubic-bezier(0.34,1.56,0.64,1) both',
    }}>
      <div style={{
        width:42, height:42, borderRadius:12, flexShrink:0,
        background:'linear-gradient(135deg,var(--brand-dark),var(--brand-light))',
        display:'flex', alignItems:'center', justifyContent:'center',
        fontSize:20, fontWeight:900, color:'#fff',
        boxShadow:'0 4px 12px var(--brand-glow)',
      }}>E</div>
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontSize:13, fontWeight:700, marginBottom:2 }}>Install Examora</div>
        <div style={{ fontSize:11, color:'var(--text-muted)' }}>Add to home screen for offline access</div>
      </div>
      <div style={{ display:'flex', gap:8, flexShrink:0 }}>
        <button onClick={handleDismiss} style={{
          background:'var(--bg-raised)', border:'1px solid var(--border)',
          color:'var(--text-muted)', padding:'6px 12px', borderRadius:'var(--r)',
          cursor:'pointer', fontFamily:'var(--font-body)', fontSize:12, fontWeight:600,
        }}>Later</button>
        <button onClick={() => install()} style={{
          background:'var(--brand)', border:'none', color:'#fff',
          padding:'6px 14px', borderRadius:'var(--r)',
          cursor:'pointer', fontFamily:'var(--font-body)', fontSize:12, fontWeight:700,
        }}>Install</button>
      </div>
    </div>
  );
}

// ── Offline Banner ────────────────────────────────────────────
export function OfflineBanner() {
  const { isOnline } = usePWA();
  const [wasOffline, setWasOffline] = useState(false);
  const [showOnline, setShowOnline] = useState(false);

  useEffect(() => {
    if (!isOnline) setWasOffline(true);
    if (isOnline && wasOffline) {
      setShowOnline(true);
      const t = setTimeout(() => setShowOnline(false), 3000);
      return () => clearTimeout(t);
    }
  }, [isOnline, wasOffline]);

  if (isOnline && !showOnline) return null;

  return (
    <div style={{
      position:'fixed', top:60, left:'50%', transform:'translateX(-50%)',
      padding:'8px 18px', borderRadius:'var(--r-full)',
      background: isOnline ? 'var(--success-dim)' : 'var(--danger-dim)',
      border:`1px solid ${isOnline ? 'var(--success)' : 'var(--danger)'}`,
      color: isOnline ? 'var(--success)' : 'var(--danger)',
      fontSize:13, fontWeight:700,
      display:'flex', alignItems:'center', gap:8,
      zIndex:9999, whiteSpace:'nowrap',
      boxShadow:'var(--shadow-lg)',
      animation:'fadeInUp 0.3s both',
    }}>
      {isOnline ? '✓ Back online!' : '⚠ You are offline — some features unavailable'}
    </div>
  );
}

// ── Update Banner ─────────────────────────────────────────────
export function UpdateBanner() {
  const { updateAvailable, applyUpdate } = usePWA();
  if (!updateAvailable) return null;
  return (
    <div style={{
      position:'fixed', top:60, left:'50%', transform:'translateX(-50%)',
      background:'var(--brand-dim)', border:'1px solid var(--brand)',
      borderRadius:'var(--r-full)', padding:'8px 16px',
      display:'flex', alignItems:'center', gap:10,
      zIndex:9999, whiteSpace:'nowrap', boxShadow:'var(--shadow-lg)',
      animation:'fadeInUp 0.3s both',
    }}>
      <span style={{ fontSize:13, color:'var(--brand-light)', fontWeight:600 }}>🔄 New version available</span>
      <button onClick={applyUpdate} style={{
        background:'var(--brand)', border:'none', color:'#fff',
        padding:'4px 12px', borderRadius:'var(--r-full)',
        cursor:'pointer', fontSize:12, fontWeight:700, fontFamily:'var(--font-body)',
      }}>Update now</button>
    </div>
  );
}

// ── Combined wrapper — use in App.jsx ─────────────────────────
export function PWAWrapper() {
  return (
    <>
      <InstallBanner />
      <OfflineBanner />
      <UpdateBanner />
    </>
  );
}

export default PWAWrapper;
