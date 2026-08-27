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
  delete: (id, force) => axios.delete(`${API}/exams/${id}`, { params: force ? { force: true } : {} }),
  deleteByYear: (year, force) => axios.delete(`${API}/exams/by-year/${year}`, { params: force ? { force: true } : {} }),
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
  generateExplanation: (id) => axios.post(`${API}/questions/${id}/generate-explanation`),
  backfillExplanations: (params) => axios.post(`${API}/questions/backfill-explanations`, params || {}),
  subjects: () => axios.get(`${API}/questions/subjects/list`),
  uploadImage: (file) => {
    const fd = new FormData();
    fd.append('image', file);
    return axios.post(`${API}/questions/upload-image`, fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  // Re-processes a zip of the original source-paper photos and patches the
  // media_url of matching live questions. force=true also re-crops rows
  // whose image already exists (use this to fix clipped/too-tight diagrams,
  // not just missing ones) — see routes/questions.js repair-diagrams.
  repairDiagrams: ({ zip, examBody, year, subjectId, force }) => {
    const fd = new FormData();
    fd.append('zip', zip);
    fd.append('exam_body', examBody);
    fd.append('year', year);
    if (subjectId) fd.append('subject_id', subjectId);
    if (force) fd.append('force', 'true');
    return axios.post(`${API}/questions/repair-diagrams`, fd, {
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

// ── IMPORT BATCHES (Milestone 3/4 staged pipeline) ──────────────
// Parallel to importAPI above — writes to staging tables and requires
// explicit review + publish before questions go live. See ImportBatchesPage
// and ImportBatchReviewPage.
export const importBatchAPI = {
  uploadZip: (file, { exam_body, year, subject_id, paper_type, expected_count }) => {
    const fd = new FormData();
    fd.append('zip', file);
    if (exam_body) fd.append('exam_body', exam_body);
    if (year) fd.append('year', year);
    if (subject_id) fd.append('subject_id', subject_id);
    if (paper_type) fd.append('paper_type', paper_type);
    if (expected_count) fd.append('expected_count', expected_count);
    return axios.post(`${API}/import/batches/zip`, fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 600000, // multi-pass pipeline (incl. Pass 5 re-verification) can take longer than the old flow
    });
  },
  list: () => axios.get(`${API}/import/batches`),
  get: (id) => axios.get(`${API}/import/batches/${id}`),
  staged: (id, status) => axios.get(`${API}/import/batches/${id}/staged`, { params: status ? { status } : {} }),
  updateStaged: (id, stagedId, data) => axios.put(`${API}/import/batches/${id}/staged/${stagedId}`, data),
  quickVerify: (id, stagedId) => axios.post(`${API}/import/batches/${id}/staged/${stagedId}/quick-verify`, {}, { timeout: 60000 }),
  publish: (id) => axios.post(`${API}/import/batches/${id}/publish`),
  cancel: (id) => axios.delete(`${API}/import/batches/${id}`),
  pages: (id) => axios.get(`${API}/import/batches/${id}/pages`),
  retryPage: (id, pageId) => axios.post(`${API}/import/batches/${id}/pages/${pageId}/retry`, {}, { timeout: 120000 }),
  fillMissing: (id, number, data) => axios.post(`${API}/import/batches/${id}/missing/${number}`, data),
  aiSolveMissing: (id) => axios.post(`${API}/import/batches/${id}/ai-solve-missing`, {}, { timeout: 300000 }),
  reconstructDiagram: (id, stagedId) => axios.post(`${API}/import/batches/${id}/staged/${stagedId}/reconstruct-diagram`, {}, { timeout: 120000 }),
  qualityCheck: (id, stagedId) => axios.post(`${API}/import/batches/${id}/staged/${stagedId}/quality-check`, {}, { timeout: 60000 }),
};

// ── Diagram repair for already-published questions whose media_url points
// to a file lost before a persistent volume was attached (see questions.js)
export const diagramRepairAPI = {
  repair: (file, { exam_body, year, subject_id }) => {
    const fd = new FormData();
    fd.append('zip', file);
    fd.append('exam_body', exam_body);
    fd.append('year', year);
    if (subject_id) fd.append('subject_id', subject_id);
    return axios.post(`${API}/questions/repair-diagrams`, fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 600000,
    });
  },
};

// ── EXAM PREPARATION SYLLABUS (Exam Body Manager) ────────────────
export const syllabusAPI = {
  examBodies: () => axios.get(`${API}/syllabus/exam-bodies`),
  createExamBody: (data) => axios.post(`${API}/syllabus/exam-bodies`, data),
  updateExamBody: (id, data) => axios.put(`${API}/syllabus/exam-bodies/${id}`, data),
  deleteExamBody: (id) => axios.delete(`${API}/syllabus/exam-bodies/${id}`),

  examinations: (examBodyId) => axios.get(`${API}/syllabus/exam-bodies/${examBodyId}/examinations`),
  createExamination: (examBodyId, data) => axios.post(`${API}/syllabus/exam-bodies/${examBodyId}/examinations`, data),
  updateExamination: (id, data) => axios.put(`${API}/syllabus/examinations/${id}`, data),
  deleteExamination: (id) => axios.delete(`${API}/syllabus/examinations/${id}`),

  subjects: (examinationId) => axios.get(`${API}/syllabus/examinations/${examinationId}/subjects`),
  createSubject: (examinationId, data) => axios.post(`${API}/syllabus/examinations/${examinationId}/subjects`, data),
  updateSubject: (id, data) => axios.put(`${API}/syllabus/subjects/${id}`, data),
  deleteSubject: (id) => axios.delete(`${API}/syllabus/subjects/${id}`),

  topics: (subjectId) => axios.get(`${API}/syllabus/subjects/${subjectId}/topics`),
  createTopic: (subjectId, data) => axios.post(`${API}/syllabus/subjects/${subjectId}/topics`, data),
  updateTopic: (id, data) => axios.put(`${API}/syllabus/topics/${id}`, data),
  deleteTopic: (id) => axios.delete(`${API}/syllabus/topics/${id}`),
  getTopic: (id) => axios.get(`${API}/syllabus/topics/${id}`),

  createSubtopic: (topicId, data) => axios.post(`${API}/syllabus/topics/${topicId}/subtopics`, data),
  deleteSubtopic: (id) => axios.delete(`${API}/syllabus/subtopics/${id}`),

  getContent: (topicId) => axios.get(`${API}/syllabus/topics/${topicId}/content`),
  generateContent: (topicId) => axios.post(`${API}/syllabus/topics/${topicId}/content/generate`, {}, { timeout: 60000 }),
  saveContent: (topicId, data) => axios.put(`${API}/syllabus/topics/${topicId}/content`, data),

  // Student-facing
  getPublishedContent: (topicId) => axios.get(`${API}/syllabus/topics/${topicId}/published-content`),
  subjectProgress: (subjectId) => axios.get(`${API}/syllabus/progress/subject/${subjectId}`),
  topicProgress: (topicId) => axios.get(`${API}/syllabus/progress/topic/${topicId}`),
  startTopic: (topicId) => axios.post(`${API}/syllabus/progress/topic/${topicId}/start`),
  completeTopic: (topicId) => axios.post(`${API}/syllabus/progress/topic/${topicId}/complete`),
  continueLearning: () => axios.get(`${API}/syllabus/continue-learning`),
};

// ── TEXTBOOK LIBRARY ──────────────────────────────────────────
export const textbookAPI = {
  upload: (file, meta) => {
    const fd = new FormData();
    fd.append('file', file);
    Object.entries(meta).forEach(([k, v]) => { if (v) fd.append(k, v); });
    return axios.post(`${API}/textbooks`, fd, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 120000 });
  },
  list: (syllabusSubjectId) => axios.get(`${API}/textbooks`, { params: syllabusSubjectId ? { syllabus_subject_id: syllabusSubjectId } : {} }),
  get: (id) => axios.get(`${API}/textbooks/${id}`),
  delete: (id) => axios.delete(`${API}/textbooks/${id}`),
  addChapter: (textbookId, data) => axios.post(`${API}/textbooks/${textbookId}/chapters`, data),
  updateChapter: (chapterId, data) => axios.put(`${API}/textbooks/chapters/${chapterId}`, data),
  deleteChapter: (chapterId) => axios.delete(`${API}/textbooks/chapters/${chapterId}`),
  setChapterTopics: (chapterId, topicIds) => axios.put(`${API}/textbooks/chapters/${chapterId}/topics`, { topic_ids: topicIds }),
  // Student-facing
  recommendedReading: (topicId) => axios.get(`${API}/textbooks/topic/${topicId}/reading`),
};

// ── SETTINGS ──────────────────────────────────────────────────
export const settingsAPI = {
  get: () => axios.get(`${API}/settings`),
  update: (data) => axios.put(`${API}/settings`, data),
};
