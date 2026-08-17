import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import axios from 'axios';
import App from './App';
import './styles/globals.css';

import { ThemeProvider } from './components/ThemeProvider';

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

// Intercept every response — on 401, clear session and go to login
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