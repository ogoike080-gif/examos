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

// Intercept every response — on 401, clear session and go to login.
//
// 402 FREE_LIMIT_REACHED (an anonymous "Practice Free" visitor, or an old
// pre-quota session, has used up their 5 free questions — see
// routes/questions.js) is deliberately NOT handled here. It used to
// redirect to /exam/billing, but that route requires a logged-in candidate
// (see App.jsx's <RequireAuth> wrapper around /exam/*) — so an anonymous
// visitor hitting this got bounced again, straight to /login, which is
// exactly the "why did Practice Free just send me to the student login
// page" bug. It also fought with the in-page paywall PracticeMode.jsx and
// StudyApp.jsx already show for this exact situation (see FreeTrialPaywall)
// — a full navigation and an in-page modal both trying to react to the same
// 402 at once. Each of those pages now handles this 402 itself, right where
// the request was made, instead of a global redirect trying to guess where
// to send every possible caller.
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