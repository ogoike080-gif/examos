import axios from 'axios';

const API = import.meta.env.VITE_API_URL || '/api';

// ── AUTH ──────────────────────────────────────────────────────
export const authAPI = {
  login: (data) => axios.post(`${API}/auth/login`, data),
  register: (data) => axios.post(`${API}/auth/register`, data),
  me: () => axios.get(`${API}/auth/me`),
  changePassword: (data) => axios.put(`${API}/auth/password`, data),
};

// ── EXAMS ─────────────────────────────────────────────────────
export const examAPI = {
  list: (params) => axios.get(`${API}/exams`, { params }),
  get: (id) => axios.get(`${API}/exams/${id}`),
  create: (data) => axios.post(`${API}/exams`, data),
  update: (id, data) => axios.put(`${API}/exams/${id}`, data),
  startSession: (id, deviceFingerprint) =>
    axios.post(`${API}/exams/${id}/start-session`, { device_fingerprint: deviceFingerprint }),
  saveAnswer: (sessionId, questionId, answer) =>
    axios.post(`${API}/exams/sessions/${sessionId}/answer`, { question_id: questionId, answer }),
  submit: (sessionId) =>
    axios.post(`${API}/exams/sessions/${sessionId}/submit`),
  checkTime: (sessionId) =>
    axios.post(`${API}/exams/sessions/${sessionId}/check-time`),
  results: (sessionId) =>
    axios.get(`${API}/exams/sessions/${sessionId}/results`),
  review: (sessionId) =>
    axios.get(`${API}/exams/sessions/${sessionId}/review`),
  debugGrade: (sessionId) =>
    axios.get(`${API}/exams/sessions/${sessionId}/debug-grade`),
};

// ── QUESTIONS ─────────────────────────────────────────────────
export const questionAPI = {
  list: (params) => axios.get(`${API}/questions`, { params }),
  get: (id) => axios.get(`${API}/questions/${id}`),
  create: (data) => axios.post(`${API}/questions`, data),
  update: (id, data) => axios.put(`${API}/questions/${id}`, data),
  delete: (id) => axios.delete(`${API}/questions/${id}`),
  bulkUpload: (questions) => axios.post(`${API}/questions/bulk`, { questions }),
  aiGenerate: (data) => axios.post(`${API}/questions/ai-generate`, data),
  subjects: () => axios.get(`${API}/questions/subjects/list`),
  uploadImage: (file) => {
    const fd = new FormData();
    fd.append('image', file);
    return axios.post(`${API}/questions/upload-image`, fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
};

// ── PROCTOR ───────────────────────────────────────────────────
export const proctorAPI = {
  logEvent: (data) => axios.post(`${API}/proctor/event`, data),
  getEvents: (sessionId) => axios.get(`${API}/proctor/session/${sessionId}/events`),
  getLive: (examId) => axios.get(`${API}/proctor/live`, { params: { exam_id: examId } }),
  action: (sessionId, action, reason) =>
    axios.post(`${API}/proctor/action`, { session_id: sessionId, action, reason }),
  analyzeSession: (sessionId) =>
    axios.post(`${API}/proctor/analyze-session/${sessionId}`),
};

// ── ANALYTICS ─────────────────────────────────────────────────
export const analyticsAPI = {
  dashboard: () => axios.get(`${API}/analytics/dashboard`),
  exam: (examId) => axios.get(`${API}/analytics/exam/${examId}`),
  question: (questionId) => axios.get(`${API}/analytics/question/${questionId}`),
  health: () => axios.get(`${API}/analytics/health`),
};

// ── CANDIDATES ────────────────────────────────────────────────
export const candidateAPI = {
  list: (params) => axios.get(`${API}/candidates`, { params }),
  classes: () => axios.get(`${API}/candidates/classes`),
  bulkRegister: (candidates) =>
    axios.post(`${API}/candidates/bulk`, { candidates }),
  importCSV: (csv_text, class_name) =>
    axios.post(`${API}/candidates/import-csv`, { csv_text, class_name }),
  assignExam: (candidateId, examId) =>
    axios.post(`${API}/candidates/${candidateId}/assign-exam`, { exam_id: examId }),
  assignClass: (class_name, exam_id) =>
    axios.post(`${API}/candidates/assign-class`, { class_name, exam_id }),
  update: (id, data) => axios.put(`${API}/candidates/${id}`, data),
  delete: (id) => axios.delete(`${API}/candidates/${id}`),
  removeFromExam: (candidateId, examId) =>
    axios.delete(`${API}/candidates/${candidateId}/exam/${examId}`),
  listParents: (candidateId) => axios.get(`${API}/candidates/${candidateId}/parents`),
  linkParent: (candidateId, data) => axios.post(`${API}/candidates/${candidateId}/link-parent`, data),
  unlinkParent: (candidateId, parentId) => axios.delete(`${API}/candidates/${candidateId}/parents/${parentId}`),
};

// ── SUBJECTS ──────────────────────────────────────────────────
export const subjectAPI = {
  list: () => axios.get(`${API}/subjects`),
  create: (data) => axios.post(`${API}/subjects`, data),
  update: (id, data) => axios.put(`${API}/subjects/${id}`, data),
  delete: (id) => axios.delete(`${API}/subjects/${id}`),
};

// ── IMPORT ────────────────────────────────────────────────────
export const importAPI = {
  questions: (data) => axios.post(`${API}/import/questions`, data),
  parseCSV: (csv_text) => axios.post(`${API}/import/csv-parse`, { csv_text }),
  parseImage: (file, exam_body, year, subject_id) => {
    const fd = new FormData();
    fd.append('image', file);
    if (exam_body) fd.append('exam_body', exam_body);
    if (year) fd.append('year', year);
    if (subject_id) fd.append('subject_id', subject_id);
    return axios.post(`${API}/import/image-extract`, fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  parseZip: (file, exam_body, year, subject_id) => {
    const fd = new FormData();
    fd.append('zip', file);
    if (exam_body) fd.append('exam_body', exam_body);
    if (year) fd.append('year', year);
    if (subject_id) fd.append('subject_id', subject_id);
    return axios.post(`${API}/import/zip-extract`, fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 300000, // batches can take a while — up to 5 min for a full booklet
    });
  },
  sourcePaperGroups: () => axios.get(`${API}/import/source-papers`),
  sourcePapers: (exam_body, year) => axios.get(`${API}/import/source-papers`, { params: { exam_body, year } }),
  sourcePapersZipURL: (exam_body, year) => `${API}/import/source-papers/zip?exam_body=${encodeURIComponent(exam_body)}&year=${encodeURIComponent(year)}`,
  deleteSourcePaper: (id) => axios.delete(`${API}/import/source-papers/${id}`),
  templateURL: () => `${API}/import/template`,
};

// ── SETTINGS ──────────────────────────────────────────────────
export const settingsAPI = {
  get: () => axios.get(`${API}/settings`),
  update: (data) => axios.put(`${API}/settings`, data),
};
