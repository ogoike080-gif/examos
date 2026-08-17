import React from 'react';
import { Outlet } from 'react-router-dom';
import { useAuthStore } from '../../store';
import { ThemeToggle } from '../../components/ThemeProvider';

export default function ParentLayout() {
  const { user, logout } = useAuthStore();

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg-base)', color: 'var(--text-primary)' }}>
      <header style={{
        height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 20px', borderBottom: '1px solid var(--border)', background: 'var(--bg-glass)',
        backdropFilter: 'blur(12px)', position: 'sticky', top: 0, zIndex: 30,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 30, height: 30, borderRadius: 8, background: 'linear-gradient(135deg,var(--brand-dark),var(--brand-light))', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, color: '#fff', fontSize: 14 }}>E</div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 14 }}>ExamOS</div>
            <div style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>Parent Portal</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>{user?.full_name}</span>
          <ThemeToggle size="sm" />
          <button onClick={logout} style={{
            padding: '6px 12px', borderRadius: 'var(--r)', border: '1px solid var(--border-md)',
            background: 'var(--bg-raised)', color: 'var(--text-secondary)', fontSize: 12, fontWeight: 600, cursor: 'pointer',
          }}>Log Out</button>
        </div>
      </header>
      <main style={{ maxWidth: 720, margin: '0 auto', padding: '20px 16px 40px' }}>
        <Outlet />
      </main>
    </div>
  );
}
