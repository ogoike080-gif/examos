import React, { useState, useEffect } from 'react';
import axios from 'axios';
import toast from 'react-hot-toast';

const API = '/api';

// ── Paystack inline payment ───────────────────────────────────
function loadPaystackScript() {
  return new Promise((resolve) => {
    if (window.PaystackPop) { resolve(); return; }
    const script = document.createElement('script');
    script.src = 'https://js.paystack.co/v1/inline.js';
    script.onload = resolve;
    document.head.appendChild(script);
  });
}

export function usePaystack() {
  const pay = async ({ email, full_name, amount, metadata = {}, onSuccess, onClose }) => {
    await loadPaystackScript();
    const res = await axios.post(`${API}/payments/initialize`, { email, full_name, amount, metadata });
    const { reference, public_key } = res.data;

    const handler = window.PaystackPop.setup({
      key: public_key,
      email,
      amount: amount * 100, // kobo
      ref: reference,
      metadata,
      currency: 'NGN',
      callback: (response) => {
        axios.post(`${API}/payments/verify`, { reference: response.reference })
          .then(r => onSuccess && onSuccess(r.data))
          .catch(() => toast.error('Payment verification failed'));
      },
      onClose: () => onClose && onClose(),
    });
    handler.openIframe();
  };

  return { pay };
}

// ── Subscription Plans ────────────────────────────────────────
const PLANS = [
  {
    id: 'free',
    name: 'Free',
    price: 0,
    color: 'var(--text-muted)',
    icon: '🆓',
    features: [
      '5 exams per month',
      'Basic result slip',
      'AI chat (10 messages/day)',
      'Standard support',
    ],
    limits: { exams_per_month: 5, ai_messages: 10 },
  },
  {
    id: 'student',
    name: 'Student',
    price: 500,
    color: 'var(--brand-light)',
    icon: '🎓',
    popular: true,
    features: [
      'Unlimited exams',
      'Premium result slip',
      'AI chat (100 messages/day)',
      'Gamification & badges',
      'Downloadable certificate',
      'Priority support',
    ],
    limits: { exams_per_month: -1, ai_messages: 100 },
  },
  {
    id: 'school',
    name: 'School',
    price: 5000,
    color: '#F59E0B',
    icon: '🏫',
    features: [
      'Unlimited students',
      'Unlimited exams',
      'AI question generator',
      'Class analytics',
      'CSV/ZIP exports',
      'Custom branding',
      'Dedicated support',
    ],
    limits: { exams_per_month: -1, ai_messages: -1 },
  },
];

// A real, deliverable email is required — Paystack needs somewhere to send
// the receipt to, and rejects placeholder addresses outright. Candidate
// accounts created via bulk import / name-only login (see routes/
// candidates.js) get an auto-generated `@ogotech.internal` address purely
// to satisfy the DB's NOT NULL constraint — it was never meant to be used
// for anything real, and sending it straight to Paystack is exactly what
// was producing '"email" must be a valid email'.
export function isRealEmail(email) {
  if (!email) return false;
  if (email.endsWith('@ogotech.internal')) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function SubscriptionPlans({ currentPlan = 'free', userEmail, onSuccess }) {
  const [loading, setLoading] = useState(null);
  const { pay } = usePaystack();
  const needsEmail = !isRealEmail(userEmail);
  const [enteredEmail, setEnteredEmail] = useState('');
  const [emailError, setEmailError] = useState('');

  const handleSubscribe = async (plan) => {
    if (plan.price === 0) return;

    let payEmail = userEmail;
    if (needsEmail) {
      if (!isRealEmail(enteredEmail)) {
        setEmailError('Enter a valid email — Paystack sends your receipt there');
        return;
      }
      payEmail = enteredEmail;
    }

    setLoading(plan.id);
    try {
      await pay({
        email: payEmail,
        amount: plan.price,
        metadata: { plan_id: plan.id, plan_name: plan.name },
        onSuccess: (data) => {
          toast.success(`${plan.name} plan activated! 🎉`);
          onSuccess && onSuccess(plan.id);
          setLoading(null);
        },
        onClose: () => {
          toast('Payment cancelled', { icon: 'ℹ' });
          setLoading(null);
        },
      });
    } catch (err) {
      toast.error(err.response?.data?.error || 'Payment failed');
      setLoading(null);
    }
  };

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '24px 16px' }}>
      <div style={{ textAlign: 'center', marginBottom: 36 }}>
        <h1 style={{ fontSize: '2rem', marginBottom: 8 }}>Choose Your Plan</h1>
        <p style={{ fontSize: 14, color: 'var(--text-muted)' }}>
          Unlock premium features to supercharge your exam preparation
        </p>
      </div>

      {needsEmail && (
        <div style={{
          maxWidth: 420, margin: '0 auto 28px', padding: '14px 18px',
          background: 'var(--bg-surface)', border: '1.5px solid var(--border-md)',
          borderRadius: 'var(--r-lg)',
        }}>
          <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
            Email for your receipt
          </label>
          <input
            type="email"
            value={enteredEmail}
            onChange={e => { setEnteredEmail(e.target.value); setEmailError(''); }}
            placeholder="you@example.com"
            style={{ width: '100%', padding: '10px 12px', borderRadius: 'var(--r)', border: `1.5px solid ${emailError ? 'var(--danger)' : 'var(--border-md)'}`, background: 'var(--bg-raised)', color: 'var(--text-primary)', fontSize: 14 }}
          />
          {emailError && <p style={{ fontSize: 12, color: 'var(--danger)', marginTop: 6 }}>{emailError}</p>}
          {!emailError && <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>Your login doesn't use an email, but Paystack needs a real one to send your payment receipt to.</p>}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: 16 }}>
        {PLANS.map(plan => {
          const isCurrent = currentPlan === plan.id;
          const isLoading = loading === plan.id;

          return (
            <div key={plan.id} style={{
              background: 'var(--bg-surface)',
              border: `1.5px solid ${plan.popular ? 'var(--brand)' : isCurrent ? 'var(--success)' : 'var(--border)'}`,
              borderRadius: 'var(--r-2xl)',
              padding: '24px 20px',
              position: 'relative',
              transition: 'all var(--t-base)',
              boxShadow: plan.popular ? 'var(--shadow-glow)' : 'none',
            }}
              onMouseOver={e => { e.currentTarget.style.transform = 'translateY(-4px)'; e.currentTarget.style.boxShadow = 'var(--shadow-lg)'; }}
              onMouseOut={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = plan.popular ? 'var(--shadow-glow)' : ''; }}
            >
              {plan.popular && (
                <div style={{
                  position: 'absolute', top: -12, left: '50%', transform: 'translateX(-50%)',
                  background: 'var(--brand)', color: '#fff',
                  padding: '4px 16px', borderRadius: 'var(--r-full)',
                  fontSize: 11, fontWeight: 700, letterSpacing: '0.05em', whiteSpace: 'nowrap',
                }}>MOST POPULAR</div>
              )}
              {isCurrent && (
                <div style={{
                  position: 'absolute', top: -12, right: 16,
                  background: 'var(--success)', color: '#fff',
                  padding: '4px 12px', borderRadius: 'var(--r-full)',
                  fontSize: 11, fontWeight: 700,
                }}>CURRENT</div>
              )}

              <div style={{ fontSize: 32, marginBottom: 12 }}>{plan.icon}</div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', fontWeight: 800, marginBottom: 4 }}>
                {plan.name}
              </div>

              <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginBottom: 20 }}>
                {plan.price === 0 ? (
                  <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.8rem', fontWeight: 900, color: 'var(--text-muted)' }}>Free</span>
                ) : (
                  <>
                    <span style={{ fontSize: 14, color: 'var(--text-muted)', alignSelf: 'flex-start', marginTop: 4 }}>₦</span>
                    <span style={{ fontFamily: 'var(--font-display)', fontSize: '1.8rem', fontWeight: 900, color: plan.color, letterSpacing: '-0.03em' }}>
                      {plan.price.toLocaleString()}
                    </span>
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>/month</span>
                  </>
                )}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 24 }}>
                {plan.features.map(f => (
                  <div key={f} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13 }}>
                    <span style={{ color: 'var(--success)', fontSize: 14, flexShrink: 0, marginTop: 1 }}>✓</span>
                    <span style={{ color: 'var(--text-secondary)' }}>{f}</span>
                  </div>
                ))}
              </div>

              <button
                onClick={() => handleSubscribe(plan)}
                disabled={isCurrent || plan.price === 0 || isLoading}
                style={{
                  width: '100%', padding: '11px', borderRadius: 'var(--r-lg)',
                  border: plan.popular ? 'none' : '1.5px solid var(--border-md)',
                  background: isCurrent ? 'var(--success-dim)' : plan.popular ? 'var(--brand)' : plan.price === 0 ? 'var(--bg-raised)' : 'var(--bg-raised)',
                  color: isCurrent ? 'var(--success)' : plan.popular ? '#fff' : 'var(--text-primary)',
                  fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 700,
                  cursor: isCurrent || plan.price === 0 ? 'default' : 'pointer',
                  transition: 'all var(--t-fast)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  opacity: isLoading ? 0.7 : 1,
                }}
              >
                {isLoading ? <><span className="spinner" />Processing...</>
                  : isCurrent ? '✓ Active Plan'
                  : plan.price === 0 ? 'Current Free Plan'
                  : `Subscribe — ₦${plan.price.toLocaleString()}`}
              </button>
            </div>
          );
        })}
      </div>

      <p style={{ textAlign: 'center', fontSize: 11, color: 'var(--text-dim)', marginTop: 24 }}>
        🔒 Secured by Paystack · All payments in Nigerian Naira (₦) · Cancel anytime
      </p>
    </div>
  );
}

// ── Payment History ───────────────────────────────────────────
export function PaymentHistory() {
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    axios.get(`${API}/payments/history`)
      .then(r => setPayments(r.data.payments || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-xl)', overflow: 'hidden' }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
        <h3 style={{ fontSize: '0.95rem' }}>Payment History</h3>
      </div>
      {loading ? (
        <div style={{ padding: 24, textAlign: 'center' }}><div className="spinner" style={{ width: 24, height: 24, margin: '0 auto' }} /></div>
      ) : payments.length === 0 ? (
        <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
          No payments yet.
        </div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              {['Date', 'Plan', 'Amount', 'Reference', 'Status'].map(h => (
                <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', borderBottom: '1px solid var(--border)', background: 'var(--bg-raised)', whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {payments.map(p => (
              <tr key={p.id}>
                <td style={{ padding: '11px 16px', fontSize: 12, borderTop: '1px solid var(--border)', fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
                  {new Date(p.created_at).toLocaleDateString('en-NG')}
                </td>
                <td style={{ padding: '11px 16px', fontSize: 13, fontWeight: 600, borderTop: '1px solid var(--border)' }}>{p.plan_name}</td>
                <td style={{ padding: '11px 16px', fontSize: 13, fontWeight: 700, borderTop: '1px solid var(--border)', color: 'var(--success)' }}>
                  ₦{Number(p.amount).toLocaleString()}
                </td>
                <td style={{ padding: '11px 16px', fontSize: 11, borderTop: '1px solid var(--border)', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
                  {p.reference?.slice(0, 16)}...
                </td>
                <td style={{ padding: '11px 16px', borderTop: '1px solid var(--border)' }}>
                  <span style={{ padding: '3px 10px', borderRadius: 'var(--r-full)', fontSize: 10, fontWeight: 700, background: p.status === 'success' ? 'var(--success-dim)' : 'var(--danger-dim)', color: p.status === 'success' ? 'var(--success)' : 'var(--danger)' }}>
                    {p.status?.toUpperCase()}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default SubscriptionPlans;
