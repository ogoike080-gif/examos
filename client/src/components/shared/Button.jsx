import React from 'react';
import styles from './Button.module.css';

export default function Button({
  children, variant = 'primary', size = 'md',
  onClick, disabled, loading, type = 'button',
  className = '', icon, fullWidth,
}) {
  return (
    <button
      type={type}
      className={[
        styles.btn,
        styles[variant],
        styles[size],
        fullWidth ? styles.fullWidth : '',
        loading ? styles.loading : '',
        className,
      ].join(' ')}
      onClick={onClick}
      disabled={disabled || loading}
    >
      {loading && <span className="spinner" style={{ width: 14, height: 14 }} />}
      {icon && !loading && <span className={styles.icon}>{icon}</span>}
      {children}
    </button>
  );
}
