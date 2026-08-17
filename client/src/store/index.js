import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import axios from 'axios';
import { io } from 'socket.io-client';

const API = import.meta.env.VITE_API_URL || '/api';
let socket = null;

// ── AUTH STORE ──────────────────────────────────────────────
export const useAuthStore = create(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      isAuthenticated: false,

login: async (email, password) => {
  const res = await axios.post(`${API}/auth/login`, { email, password });
  const { token, user } = res.data;
  // Set on axios headers immediately
  axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
  set({ user, token, isAuthenticated: true });
  return user;
},

logout: () => {
  delete axios.defaults.headers.common['Authorization'];
  localStorage.removeItem('examos-auth');
  if (socket) { socket.disconnect(); socket = null; }
  set({ user: null, token: null, isAuthenticated: false });
},

      hydrate: () => {
        const { token } = get();
        if (token) {
          axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
        }
      },
    }),
    { name: 'examos-auth', partialize: (s) => ({ user: s.user, token: s.token, isAuthenticated: s.isAuthenticated }) }
  )
);

// ── SOCKET STORE ─────────────────────────────────────────────
export const useSocketStore = create((set, get) => ({
  socket: null,
  connected: false,
  liveViolations: [],
  activeCandidates: new Map(),

  connect: (token) => {
    if (socket?.connected) return socket;

 socket = io('http://localhost:5000', {
  auth: { token },
  transports: ['polling', 'websocket'],
  reconnection: true,
  reconnectionAttempts: 5,
  reconnectionDelay: 2000,
});

    socket.on('connect', () => {
      set({ socket, connected: true });
      console.log('🔌 Socket connected:', socket.id);
    });

    socket.on('disconnect', () => {
      set({ connected: false });
    });

    socket.on('live-violation', (data) => {
      set((s) => ({
        liveViolations: [data, ...s.liveViolations].slice(0, 100),
      }));
    });

    socket.on('candidate-joined', (data) => {
      set((s) => {
        const map = new Map(s.activeCandidates);
        map.set(data.user.id, { ...data, status: 'active' });
        return { activeCandidates: map };
      });
    });

    socket.on('candidate-disconnected', (data) => {
      set((s) => {
        const map = new Map(s.activeCandidates);
        const c = map.get(data.candidate.id);
        if (c) map.set(data.candidate.id, { ...c, status: 'disconnected' });
        return { activeCandidates: map };
      });
    });

    socket.on('candidate-submitted', (data) => {
      set((s) => {
        const map = new Map(s.activeCandidates);
        const c = map.get(data.candidate.id);
        if (c) map.set(data.candidate.id, { ...c, status: 'submitted' });
        return { activeCandidates: map };
      });
    });

    set({ socket });
    return socket;
  },

  getSocket: () => socket,
  clearViolations: () => set({ liveViolations: [] }),
}));

// ── EXAM STORE ───────────────────────────────────────────────
export const useExamStore = create((set, get) => ({
  currentSession: null,
  currentExam: null,
  questions: [],
  answers: {},
  currentQuestionIndex: 0,
  flagged: new Set(),
  timeRemaining: 0,
  timerInterval: null,
  examStatus: 'idle', // idle | starting | active | paused | submitted

  initExam: (session, exam, questions) => {
    const existing = JSON.parse(session.answers || '{}');
    set({
      currentSession: session,
      currentExam: exam,
      questions,
      answers: existing,
      currentQuestionIndex: 0,
      flagged: new Set(),
      timeRemaining: session.time_remaining_seconds || (exam.duration_minutes * 60),
      examStatus: 'active',
    });
  },

  setAnswer: (questionId, answer) => {
    set((s) => ({ answers: { ...s.answers, [questionId]: answer } }));
  },

  toggleFlag: (questionId) => {
    set((s) => {
      const f = new Set(s.flagged);
      f.has(questionId) ? f.delete(questionId) : f.add(questionId);
      return { flagged: f };
    });
  },

  goToQuestion: (idx) => set({ currentQuestionIndex: idx }),
  nextQuestion: () => set((s) => ({ currentQuestionIndex: Math.min(s.currentQuestionIndex + 1, s.questions.length - 1) })),
  prevQuestion: () => set((s) => ({ currentQuestionIndex: Math.max(s.currentQuestionIndex - 1, 0) })),

  startTimer: (onExpire) => {
    const interval = setInterval(() => {
      set((s) => {
        if (s.timeRemaining <= 1) {
          clearInterval(interval);
          onExpire?.();
          return { timeRemaining: 0, timerInterval: null };
        }
        return { timeRemaining: s.timeRemaining - 1 };
      });
    }, 1000);
    set({ timerInterval: interval });
  },

  stopTimer: () => {
    const { timerInterval } = get();
    if (timerInterval) clearInterval(timerInterval);
    set({ timerInterval: null });
  },

  setExamStatus: (status) => set({ examStatus: status }),

  reset: () => {
    const { timerInterval } = get();
    if (timerInterval) clearInterval(timerInterval);
    set({
      currentSession: null, currentExam: null, questions: [],
      answers: {}, currentQuestionIndex: 0, flagged: new Set(),
      timeRemaining: 0, timerInterval: null, examStatus: 'idle',
    });
  },
}));
