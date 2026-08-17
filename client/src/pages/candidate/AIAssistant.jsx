import React, { useState, useRef, useEffect } from 'react';
import axios from 'axios';

const API = import.meta.env.VITE_API_URL || '/api';

function Message({ msg }) {
  const isUser = msg.role === 'user';
  return (
    <div style={{
      display:'flex', justifyContent: isUser ? 'flex-end' : 'flex-start',
      marginBottom:12, animation:'fadeInUp 0.3s both',
    }}>
      {!isUser && (
        <div style={{
          width:28, height:28, borderRadius:8, flexShrink:0, marginRight:8, marginTop:2,
          background:'linear-gradient(135deg,var(--brand-dark),var(--brand-light))',
          display:'flex', alignItems:'center', justifyContent:'center',
          fontSize:13, fontWeight:900, color:'#fff',
        }}>E</div>
      )}
      <div style={{
        maxWidth:'80%',
        padding:'10px 14px',
        borderRadius: isUser ? '16px 16px 4px 16px' : '4px 16px 16px 16px',
        background: isUser ? 'var(--brand)' : 'var(--bg-raised)',
        color: isUser ? '#fff' : 'var(--text-primary)',
        fontSize:13, lineHeight:1.65,
        border: isUser ? 'none' : '1px solid var(--border)',
        boxShadow: isUser ? '0 2px 12px var(--brand-glow)' : 'var(--shadow-sm)',
      }}>
        {msg.content}
      </div>
    </div>
  );
}

export default function AIAssistant({ isOpen, onClose }) {
  const [messages, setMessages] = useState([
    { role:'assistant', content:"Hi! I'm your AI study assistant. Ask me anything about your subjects, exam tips, or request explanations. How can I help you today? 🎓" }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior:'smooth' });
  }, [messages]);

  useEffect(() => {
    if (isOpen) setTimeout(() => inputRef.current?.focus(), 300);
  }, [isOpen]);

  const send = async (e) => {
    e?.preventDefault();
    const text = input.trim();
    if (!text || loading) return;
    setInput('');
    setMessages(m => [...m, { role:'user', content: text }]);
    setLoading(true);

    try {
      const history = messages.slice(-8).map(m => ({ role: m.role, content: m.content }));

      const res = await axios.post(`${API}/ai/chat`, { message: text, history });
      const reply = res.data.reply || "Sorry, I couldn't process that. Please try again.";
      setMessages(m => [...m, { role:'assistant', content: reply }]);
    } catch (err) {
      setMessages(m => [...m, { role:'assistant', content: err.response?.data?.error || "I'm having trouble connecting. Please check your internet and try again." }]);
    } finally { setLoading(false); }
  };

  const quickPrompts = [
    '📚 Explain photosynthesis',
    '🔢 How to solve quadratic equations',
    '📝 WAEC exam tips',
    '🧪 Chemistry bonding basics',
  ];

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop on mobile */}
      <div
        onClick={onClose}
        style={{
          position:'fixed', inset:0, background:'rgba(0,0,0,0.5)',
          backdropFilter:'blur(4px)', zIndex:98,
          display:'block',
        }}
        className="mobile-only"
      />

      <div style={{
        position:'fixed',
        bottom:80, right:20,
        width: 'min(380px, calc(100vw - 40px))',
        height: 'min(520px, 70dvh)',
        background:'var(--bg-surface)',
        border:'1px solid var(--border-md)',
        borderRadius:'var(--r-2xl)',
        boxShadow:'var(--shadow-xl)',
        zIndex:99,
        display:'flex', flexDirection:'column',
        overflow:'hidden',
        animation:'scaleIn 0.3s cubic-bezier(0.34,1.56,0.64,1) both',
      }}>

        {/* Header */}
        <div style={{
          padding:'14px 16px',
          borderBottom:'1px solid var(--border)',
          display:'flex', alignItems:'center', gap:10,
          background:'linear-gradient(135deg, var(--brand-dark), var(--brand))',
          flexShrink:0,
        }}>
          <div style={{
            width:32, height:32, borderRadius:9,
            background:'rgba(255,255,255,0.2)',
            display:'flex', alignItems:'center', justifyContent:'center',
            fontSize:16,
          }}>🤖</div>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:14, fontWeight:700, color:'#fff' }}>AI Study Assistant</div>
            <div style={{ fontSize:11, color:'rgba(255,255,255,0.7)', display:'flex', alignItems:'center', gap:4 }}>
              <span style={{ width:6, height:6, borderRadius:'50%', background:'#4ADE80', display:'inline-block' }}/>
              Online · Powered by AI
            </div>
          </div>
          <button onClick={onClose} style={{
            background:'rgba(255,255,255,0.15)', border:'none', borderRadius:'var(--r)',
            width:28, height:28, cursor:'pointer', color:'#fff', fontSize:14,
            display:'flex', alignItems:'center', justifyContent:'center',
          }}>✕</button>
        </div>

        {/* Messages */}
        <div style={{ flex:1, overflowY:'auto', padding:'16px 14px', scrollBehavior:'smooth' }}>
          {messages.map((m, i) => <Message key={i} msg={m} />)}

          {loading && (
            <div style={{ display:'flex', gap:8, marginBottom:12 }}>
              <div style={{ width:28, height:28, borderRadius:8, background:'linear-gradient(135deg,var(--brand-dark),var(--brand-light))', display:'flex', alignItems:'center', justifyContent:'center', fontSize:13, fontWeight:900, color:'#fff' }}>E</div>
              <div style={{ padding:'10px 14px', background:'var(--bg-raised)', borderRadius:'4px 16px 16px 16px', border:'1px solid var(--border)' }}>
                <div style={{ display:'flex', gap:4, alignItems:'center' }}>
                  {[0,1,2].map(i => (
                    <div key={i} style={{ width:6, height:6, borderRadius:'50%', background:'var(--brand-light)', animation:`pulse 1.2s ${i*0.2}s ease-in-out infinite` }} />
                  ))}
                </div>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Quick prompts */}
        {messages.length === 1 && (
          <div style={{ padding:'0 12px 8px', display:'flex', flexWrap:'wrap', gap:6 }}>
            {quickPrompts.map(p => (
              <button key={p} onClick={() => { setInput(p.slice(2)); setTimeout(send, 100); }}
                style={{
                  padding:'5px 10px', borderRadius:'var(--r-full)',
                  border:'1px solid var(--border-md)',
                  background:'var(--bg-raised)', color:'var(--text-secondary)',
                  fontSize:11, cursor:'pointer', fontFamily:'var(--font-body)', fontWeight:500,
                  transition:'all var(--t-fast)', WebkitTapHighlightColor:'transparent',
                }}
                onMouseOver={e => { e.currentTarget.style.borderColor='var(--brand)'; e.currentTarget.style.color='var(--brand-light)'; }}
                onMouseOut={e => { e.currentTarget.style.borderColor='var(--border-md)'; e.currentTarget.style.color='var(--text-secondary)'; }}
              >{p}</button>
            ))}
          </div>
        )}

        {/* Input */}
        <div style={{
          padding:'10px 12px',
          borderTop:'1px solid var(--border)',
          flexShrink:0,
        }}>
          <form onSubmit={send} style={{ display:'flex', gap:8 }}>
            <input
              ref={inputRef}
              type="text"
              placeholder="Ask anything..."
              value={input}
              onChange={e => setInput(e.target.value)}
              style={{ flex:1, padding:'9px 12px', fontSize:13, borderRadius:'var(--r-full)', border:'1px solid var(--border-md)', background:'var(--bg-raised)' }}
            />
            <button type="submit" disabled={!input.trim() || loading}
              style={{
                width:36, height:36, borderRadius:'50%', border:'none',
                background: input.trim() && !loading ? 'var(--brand)' : 'var(--bg-overlay)',
                color: input.trim() && !loading ? '#fff' : 'var(--text-muted)',
                cursor: input.trim() && !loading ? 'pointer' : 'default',
                fontSize:16, display:'flex', alignItems:'center', justifyContent:'center',
                flexShrink:0, transition:'all var(--t-fast)',
              }}>→</button>
          </form>
        </div>
      </div>
    </>
  );
}

// Floating AI button
export function AIButton({ onClick, isOpen }) {
  return (
    <button onClick={onClick}
      style={{
        position:'fixed', bottom:80, right:20,
        width:52, height:52, borderRadius:'50%',
        background: isOpen ? 'var(--bg-raised)' : 'linear-gradient(135deg, var(--brand-dark), var(--brand-light))',
        border: isOpen ? '1px solid var(--border-md)' : 'none',
        color: isOpen ? 'var(--text-muted)' : '#fff',
        cursor:'pointer', fontSize:22,
        display:'flex', alignItems:'center', justifyContent:'center',
        boxShadow: isOpen ? 'var(--shadow-md)' : '0 4px 20px var(--brand-glow), var(--shadow-lg)',
        transition:'all var(--t-spring)',
        zIndex:97,
        WebkitTapHighlightColor:'transparent',
      }}
      onMouseOver={e => { if (!isOpen) e.currentTarget.style.transform='scale(1.08)'; }}
      onMouseOut={e => e.currentTarget.style.transform='scale(1)'}
      title={isOpen ? 'Close AI Assistant' : 'Open AI Study Assistant'}
    >
      {isOpen ? '✕' : '🤖'}
    </button>
  );
}
