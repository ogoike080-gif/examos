import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useAuthStore } from '../../store';
import { SubscriptionPlans, PaymentHistory } from './PaystackPayment';

const API = '/api';

export default function BillingPage() {
  const { user } = useAuthStore();
  const [sub, setSub] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadSubscription = () => {
    axios.get(`${API}/payments/subscription`)
      .then(r => setSub(r.data))
      .catch(() => setSub({ plan_id: 'free', plan_name: 'Free' }))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadSubscription(); }, []);

  if (loading) {
    return (
      <div style={{ display:'flex', justifyContent:'center', padding:60 }}>
        <div className="spinner" style={{ width:28, height:28 }} />
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '24px 16px 60px' }}>
      <SubscriptionPlans
        currentPlan={sub?.plan_id || 'free'}
        userEmail={user?.email}
        onSuccess={loadSubscription}
      />
      <div style={{ marginTop: 40 }}>
        <PaymentHistory />
      </div>
    </div>
  );
}
