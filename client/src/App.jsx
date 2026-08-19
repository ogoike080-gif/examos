import React, { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { useAuthStore } from './store';

// Public pages
import LandingPage  from './pages/LandingPage';
import PracticeMode from './pages/PracticeMode';
import LoginPage    from './pages/LoginPage';

// Admin pages
import AdminLayout        from './pages/admin/AdminLayout';
import AdminDashboard     from './pages/admin/AdminDashboard';
import ExamsPage          from './pages/admin/ExamsPage';
import ExamBuilderPage    from './pages/admin/ExamBuilderPage';
import QuestionBankPage   from './pages/admin/QuestionBankPage';
import QuestionBuilderPage from './pages/admin/QuestionBuilderPage';
import LiveMonitorPage    from './pages/admin/LiveMonitorPage';
import AnalyticsPage      from './pages/admin/AnalyticsPage';
import CandidatesPage     from './pages/admin/CandidatesPage';
import SubjectsPage       from './pages/admin/SubjectsPage';
import ImportPage         from './pages/admin/ImportPage';
import ImportBatchesPage  from './pages/admin/ImportBatchesPage';
import ImportBatchReviewPage from './pages/admin/ImportBatchReviewPage';
import ExamBodyManagerPage from './pages/admin/ExamBodyManagerPage';
import TextbookLibraryPage from './pages/admin/TextbookLibraryPage';
import ExamPrepDashboard from './pages/candidate/ExamPrepDashboard';
import ExamSelectionPage from './pages/candidate/ExamSelectionPage';
import SubjectSelectionPage from './pages/candidate/SubjectSelectionPage';
import TopicListPage from './pages/candidate/TopicListPage';
import TopicLearningPage from './pages/candidate/TopicLearningPage';
import SettingsPage       from './pages/admin/SettingsPage';
import AdminResultsPage   from './pages/admin/AdminResultsPage';
import EssayGradingPage   from './pages/admin/EssayGradingPage';


// At the top with other imports:
import StudyApp from './pages/StudyApp';



// Candidate pages — all from one file, no duplicates
import {
  CandidateLayout,
  CandidateDashboard,
  ResultsPage,
  ReviewPage,
} from './pages/candidate/CandidateLayout';
import ExamBrowserPage from './pages/candidate/ExamBrowserPage';
import { StudentProfile } from './pages/candidate/GamificationSystem';
import BillingPage from './pages/candidate/BillingPage';
import InsightsPage from './pages/candidate/InsightsPage';
import ParentLayout from './pages/parent/ParentLayout';
import ParentDashboard from './pages/parent/ParentDashboard';
import { CertificatePage } from './pages/candidate/Certificate';

// PWA banners
import PWAWrapper from './components/PWAComponents';

// ── Auth guard ────────────────────────────────────────────────
function RequireAuth({ children, roles }) {
  const { isAuthenticated, user } = useAuthStore();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user?.role)) return <Navigate to="/unauthorized" replace />;
  return children;
}

// ── Redirect logged-in users away from landing/login ─────────
function SmartHome() {
  const { isAuthenticated, user } = useAuthStore();
  if (!isAuthenticated) return <LandingPage />;
  if (user?.role === 'candidate') return <Navigate to="/exam" replace />;
  if (user?.role === 'parent') return <Navigate to="/parent" replace />;
  return <Navigate to="/admin" replace />;
}

export default function App() {
  const { hydrate } = useAuthStore();
  useEffect(() => { hydrate(); }, []);

  return (
    <>
      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            background: 'var(--bg-surface)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border-md)',
            fontSize: '13px',
            fontFamily: 'Inter, sans-serif',
            borderRadius: '12px',
            boxShadow: 'var(--shadow-lg)',
          },
          success: { iconTheme: { primary: '#10B981', secondary: 'var(--bg-surface)' } },
          error:   { iconTheme: { primary: '#EF4444', secondary: 'var(--bg-surface)' } },
        }}
      />

      {/* PWA banners — install prompt, offline notice, update prompt */}
      <PWAWrapper />

      <Routes>

        {/* ── PUBLIC ROUTES ── */}
        <Route path="/"         element={<SmartHome />} />
        <Route path="/practice" element={<PracticeMode />} />

<Route path="/study" element={<StudyApp />} />

        <Route path="/login"    element={<LoginPage />} />
        <Route path="/unauthorized" element={
          <div style={{ minHeight:'100dvh', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:12, background:'var(--bg-base)', fontFamily:'var(--font-body)' }}>
            <div style={{ fontSize:56 }}>🚫</div>
            <h2 style={{ fontFamily:'var(--font-display)' }}>Access Denied</h2>
            <p style={{ color:'var(--text-muted)', fontSize:14 }}>You don't have permission to view this page.</p>
            <button className="btn btn-secondary" onClick={() => window.history.back()}>← Go Back</button>
          </div>
        } />

        {/* ── ADMIN ROUTES ── */}
        <Route path="/admin" element={
          <RequireAuth roles={['superadmin','admin','examiner','proctor']}>
            <AdminLayout />
          </RequireAuth>
        }>
          <Route index                     element={<AdminDashboard />} />
          <Route path="results"            element={<AdminResultsPage />} />
          <Route path="essays"             element={<EssayGradingPage />} />
          <Route path="exams"              element={<ExamsPage />} />
          <Route path="exams/new"          element={<ExamBuilderPage />} />
          <Route path="exams/:id/edit"     element={<ExamBuilderPage />} />
          <Route path="questions"          element={<QuestionBankPage />} />
          <Route path="questions/new"      element={<QuestionBuilderPage />} />
          <Route path="questions/:id/edit" element={<QuestionBuilderPage />} />
          <Route path="monitor"            element={<LiveMonitorPage />} />
          <Route path="analytics"          element={<AnalyticsPage />} />
          <Route path="candidates"         element={<CandidatesPage />} />
          <Route path="subjects"           element={<SubjectsPage />} />
          <Route path="import"             element={<ImportPage />} />
          <Route path="import/batches"     element={<ImportBatchesPage />} />
          <Route path="import/batches/:id" element={<ImportBatchReviewPage />} />
          <Route path="syllabus" element={<ExamBodyManagerPage />} />
          <Route path="textbooks" element={<TextbookLibraryPage />} />
          <Route path="settings"           element={<SettingsPage />} />
        </Route>

        {/* ── PARENT ROUTES ── */}
        <Route path="/parent" element={
          <RequireAuth roles={['parent']}>
            <ParentLayout />
          </RequireAuth>
        }>
          <Route index element={<ParentDashboard />} />
        </Route>

        {/* ── CANDIDATE ROUTES (shared bottom-nav layout) ── */}
        <Route path="/exam" element={
          <RequireAuth roles={['candidate']}>
            <CandidateLayout />
          </RequireAuth>
        }>
          <Route index                    element={<CandidateDashboard />} />
          <Route path="result/:sessionId" element={<ResultsPage />} />
          <Route path="result/:sessionId/review" element={<ReviewPage />} />
          <Route path="profile"           element={<StudentProfile />} />
          <Route path="billing"           element={<BillingPage />} />
          <Route path="insights"          element={<InsightsPage />} />
          <Route path="prep"                                    element={<ExamPrepDashboard />} />
          <Route path="prep/:examBodyId"                        element={<ExamSelectionPage />} />
          <Route path="prep/:examBodyId/:examinationId"         element={<SubjectSelectionPage />} />
          <Route path="prep/:examBodyId/:examinationId/:subjectId" element={<TopicListPage />} />
          <Route path="prep/topic/:topicId"                     element={<TopicLearningPage />} />
        </Route>

        {/* ── FULLSCREEN CANDIDATE ROUTES (no shared layout) ── */}
        <Route path="/exam/take/:examId" element={
          <RequireAuth roles={['candidate']}>
            <ExamBrowserPage />
          </RequireAuth>
        } />
        <Route path="/exam/certificate/:sessionId" element={
          <RequireAuth roles={['candidate']}>
            <CertificatePage />
          </RequireAuth>
        } />

        {/* ── 404 ── */}
        <Route path="*" element={<Navigate to="/" replace />} />

    

      </Routes>
    </>
  );
}
