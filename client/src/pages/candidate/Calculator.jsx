import React, { useState, useEffect, useCallback } from 'react';

const BTN = [
  ['C', '±', '%', '÷'],
  ['7', '8', '9', '×'],
  ['4', '5', '6', '−'],
  ['1', '2', '3', '+'],
  ['0', '.', '⌫', '='],
];

export default function Calculator({ onClose }) {
  const [display, setDisplay] = useState('0');
  const [prev, setPrev] = useState(null);
  const [op, setOp] = useState(null);
  const [fresh, setFresh] = useState(false);
  const [history, setHistory] = useState('');

  const calculate = useCallback((a, b, operator) => {
    const x = parseFloat(a), y = parseFloat(b);
    switch (operator) {
      case '+': return x + y;
      case '−': return x - y;
      case '×': return x * y;
      case '÷': return y === 0 ? 'Error' : x / y;
      default: return y;
    }
  }, []);

  const format = (n) => {
    if (n === 'Error') return 'Error';
    const s = parseFloat(n.toPrecision(12));
    return String(s).length > 12 ? s.toExponential(6) : String(s);
  };

  const press = useCallback((val) => {
    if (val === 'C') {
      setDisplay('0'); setPrev(null); setOp(null); setFresh(false); setHistory('');
      return;
    }
    if (val === '⌫') {
      setDisplay(d => d.length > 1 ? d.slice(0, -1) : '0');
      return;
    }
    if (val === '±') {
      setDisplay(d => d.startsWith('-') ? d.slice(1) : '-' + d);
      return;
    }
    if (val === '%') {
      setDisplay(d => format(parseFloat(d) / 100));
      return;
    }
    if (['+', '−', '×', '÷'].includes(val)) {
      if (op && !fresh) {
        const result = calculate(prev, display, op);
        const r = format(result);
        setDisplay(r);
        setPrev(r);
        setHistory(`${r} ${val}`);
      } else {
        setPrev(display);
        setHistory(`${display} ${val}`);
      }
      setOp(val);
      setFresh(true);
      return;
    }
    if (val === '=') {
      if (!op || !prev) return;
      const result = calculate(prev, display, op);
      const r = typeof result === 'number' ? format(result) : result;
      setHistory(`${prev} ${op} ${display} =`);
      setDisplay(r);
      setPrev(null); setOp(null); setFresh(false);
      return;
    }
    if (val === '.') {
      if (fresh) { setDisplay('0.'); setFresh(false); return; }
      if (!display.includes('.')) setDisplay(d => d + '.');
      return;
    }
    // digit
    if (fresh || display === '0') {
      setDisplay(val); setFresh(false);
    } else {
      if (display.replace('-','').replace('.','').length >= 12) return;
      setDisplay(d => d + val);
    }
  }, [display, op, prev, fresh, calculate]);

  // Keyboard support
  useEffect(() => {
    const map = {
      '0':'0','1':'1','2':'2','3':'3','4':'4',
      '5':'5','6':'6','7':'7','8':'8','9':'9',
      '.':'.', 'Enter':'=', '=':'=', '+':'+',
      '-':'−', '*':'×', '/':'÷', 'Backspace':'⌫',
      'Escape':'C', '%':'%',
    };
    const handler = (e) => {
      if (map[e.key]) { e.preventDefault(); press(map[e.key]); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [press]);

  const isOp = (v) => ['+','−','×','÷'].includes(v);
  const isEq = (v) => v === '=';
  const isClear = (v) => v === 'C';

  return (
    <div style={{
      position: 'fixed',
      bottom: 24, right: 24,
      width: 260,
      background: '#1C1C1E',
      borderRadius: 20,
      boxShadow: '0 24px 60px rgba(0,0,0,0.6)',
      border: '1px solid rgba(255,255,255,0.1)',
      overflow: 'hidden',
      zIndex: 9999,
      userSelect: 'none',
      fontFamily: "'SF Pro Display', 'Segoe UI', sans-serif",
    }}>

      {/* Title bar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 14px 4px',
      }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.4)', letterSpacing: '0.05em' }}>
          CALCULATOR
        </span>
        <button onClick={onClose} style={{
          background: '#FF5F57', border: 'none', borderRadius: '50%',
          width: 14, height: 14, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 10, color: '#7A0000', fontWeight: 900,
        }}>✕</button>
      </div>

      {/* History */}
      <div style={{
        padding: '0 16px 4px', height: 18,
        textAlign: 'right', fontSize: 12,
        color: 'rgba(255,255,255,0.3)',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {history}
      </div>

      {/* Display */}
      <div style={{
        padding: '4px 16px 12px',
        textAlign: 'right',
        fontSize: display.length > 9 ? 28 : display.length > 6 ? 36 : 44,
        fontWeight: 300,
        color: '#FFFFFF',
        letterSpacing: '-0.02em',
        lineHeight: 1,
        minHeight: 52,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}>
        {display}
      </div>

      {/* Buttons */}
      <div style={{ padding: '0 8px 10px' }}>
        {BTN.map((row, ri) => (
          <div key={ri} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            {row.map((btn) => {
              const wide = btn === '0';
              const orange = isOp(btn) || isEq(btn);
              const gray = isClear(btn) || btn === '±' || btn === '%';
              const active = op === btn;
              return (
                <button
                  key={btn}
                  onClick={() => press(btn)}
                  style={{
                    flex: wide ? 2 : 1,
                    height: 52,
                    borderRadius: 12,
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: btn === '⌫' ? 18 : 20,
                    fontWeight: gray ? 500 : 400,
                    transition: 'opacity 0.1s, transform 0.08s',
                    background: active
                      ? '#FFFFFF'
                      : orange
                      ? '#FF9F0A'
                      : gray
                      ? '#636366'
                      : '#2C2C2E',
                    color: active ? '#FF9F0A' : orange ? '#FFFFFF' : gray ? '#000000' : '#FFFFFF',
                    textAlign: wide ? 'left' : 'center',
                    paddingLeft: wide ? 20 : 0,
                  }}
                  onMouseDown={e => e.currentTarget.style.opacity = '0.7'}
                  onMouseUp={e => e.currentTarget.style.opacity = '1'}
                  onMouseLeave={e => e.currentTarget.style.opacity = '1'}
                >
                  {btn}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {/* Keyboard hint */}
      <div style={{
        textAlign: 'center', fontSize: 10,
        color: 'rgba(255,255,255,0.2)',
        paddingBottom: 10, letterSpacing: '0.04em',
      }}>
        Keyboard supported
      </div>
    </div>
  );
}
