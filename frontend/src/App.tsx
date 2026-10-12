import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { lazy, Suspense } from 'react';
import { BrowserRouter, Link, Route, Routes } from 'react-router';
import { RequireAuth } from './components/auth/RequireAuth';
import { AppShell } from './components/layout/AppShell';
import { OnboardingDialog } from './components/onboarding/OnboardingDialog';
import { useOnboarding } from './components/onboarding/useOnboarding';
import { Skeleton } from './components/ui/Skeleton';
import { LoginPage } from './pages/LoginPage';

const ExamListPage = lazy(() =>
  import('./pages/ExamListPage').then((module) => ({ default: module.ExamListPage })),
);
const ExamDetailPage = lazy(() =>
  import('./pages/ExamDetailPage').then((module) => ({ default: module.ExamDetailPage })),
);
const ExamReviewPage = lazy(() =>
  import('./pages/ExamReviewPage').then((module) => ({ default: module.ExamReviewPage })),
);
const QuizSetupPage = lazy(() =>
  import('./pages/QuizSetupPage').then((module) => ({ default: module.QuizSetupPage })),
);
const QuizPlayerPage = lazy(() =>
  import('./pages/QuizPlayerPage').then((module) => ({ default: module.QuizPlayerPage })),
);
const QuizResultPage = lazy(() =>
  import('./pages/QuizResultPage').then((module) => ({ default: module.QuizResultPage })),
);
const BankPage = lazy(() =>
  import('./pages/BankPage').then((module) => ({ default: module.BankPage })),
);

const queryClient = new QueryClient();

function PageFallback() {
  return (
    <section className="page page-container" style={{ paddingTop: '80px' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <Skeleton width="40%" height="32px" />
        <Skeleton width="70%" height="16px" />
        <Skeleton width="100%" height="140px" />
      </div>
    </section>
  );
}

function OnboardingGate() {
  const { onboarded, complete } = useOnboarding();
  return <OnboardingDialog open={!onboarded} onClose={complete} />;
}

function NotFound() {
  return (
    <section className="page page-container">
      <h1 className="page__title">404</h1>
      <p className="page__subtitle">
        Página não encontrada — a rota colapsou além do horizonte de eventos.
      </p>
      <Link
        to="/"
        className="text-mono"
        style={{
          color: '#f97316',
          fontSize: '0.85rem',
          letterSpacing: '1px',
          textTransform: 'uppercase',
          textDecoration: 'none',
        }}
      >
        ← voltar ao terminal
      </Link>
    </section>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<RequireAuth />}>
            <Route
              element={
                <>
                  <AppShell />
                  <OnboardingGate />
                </>
              }
            >
              <Route
                index
                element={
                  <Suspense fallback={<PageFallback />}>
                    <ExamListPage />
                  </Suspense>
                }
              />
              <Route
                path="/exam/:id"
                element={
                  <Suspense fallback={<PageFallback />}>
                    <ExamDetailPage />
                  </Suspense>
                }
              />
              <Route
                path="/exam/:id/review"
                element={
                  <Suspense fallback={<PageFallback />}>
                    <ExamReviewPage />
                  </Suspense>
                }
              />
              <Route
                path="/quiz/setup/:examId"
                element={
                  <Suspense fallback={<PageFallback />}>
                    <QuizSetupPage />
                  </Suspense>
                }
              />
              <Route
                path="/banco"
                element={
                  <Suspense fallback={<PageFallback />}>
                    <BankPage />
                  </Suspense>
                }
              />
              <Route
                path="/quiz/:examId"
                element={
                  <Suspense fallback={<PageFallback />}>
                    <QuizPlayerPage />
                  </Suspense>
                }
              />
              <Route
                path="/quiz/:quizId/result"
                element={
                  <Suspense fallback={<PageFallback />}>
                    <QuizResultPage />
                  </Suspense>
                }
              />
              <Route path="*" element={<NotFound />} />
            </Route>
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
