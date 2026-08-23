import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import axios from 'axios';
import App from './App';
import './styles/globals.css';

import { ThemeProvider } from './components/ThemeProvider';
import { getAnonId } from './utils/anonId';

// Sent on every request so the server can track free-trial quota for an
// anonymous "Practice Free" visitor who hasn't logged in — harmless for
// logged-in requests too, since the server only reads it when there's no
// authenticated user attached to the request. See utils/anonId.js.
axios.defaults.headers.common['x-anon-id'] = getAnonId();


// Set token on axios BEFORE anything renders
function restoreToken() {
  try {
    const raw = localStorage.getItem('examos-auth');
    if (!raw) return null;
    const token = JSON.parse(raw)?.state?.token;
    if (token) {
      axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
      return token;
    }
  } catch (e) {}
  return null;
}

restoreToken();

// Intercept every response — on 401, clear session and go to login. On 402
// with code FREE_LIMIT_REACHED, the candidate has used all 10 free trial
// questions (see routes/questions.js) — send them to the pricing page
// instead of letting whichever screen they were on show an empty/broken
// state. Handled globally here so every page that fetches questions
// (Practice Mode, Study Mode, Topic practice) gets this for free.
axios.interceptors.response.use(
  (res) => res,
  (error) => {
    if (error.response?.status === 401) {
      const url = error.config?.url || '';
      // Don't redirect if the login call itself failed
      if (!url.includes('/auth/login')) {
        localStorage.removeItem('examos-auth');
        delete axios.defaults.headers.common['Authorization'];
        window.location.href = '/login';
      }
    }
    if (error.response?.status === 402 && error.response?.data?.code === 'FREE_LIMIT_REACHED') {
      if (!window.location.pathname.startsWith('/exam/billing')) {
        window.location.href = '/exam/billing?trial_ended=true';
      }
    }
    return Promise.reject(error);
  }
);

import { registerSW } from './hooks/usePWA';
registerSW();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ThemeProvider>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ThemeProvider>
  </React.StrictMode>
);