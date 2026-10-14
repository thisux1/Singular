import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { lazy, Suspense } from 'react';
import { BrowserRouter, Link, Route, Routes } from 'react-router';
import { RequireAuth } from './components/auth/RequireAuth';
import { AppShell } from './components/layout/AppShell';
import { OnboardingDialog } from './components/onboarding/OnboardingDialog';
import { useOnboarding } from './components/onboarding/useOnboarding';
import { useGpuTier } from './hooks/useGpuTier';
import { usePrefersReducedMotion } from './hooks/useMediaQuery';
import { isTouchLikeEnvironment } from './hooks/useMousePosition';
import { usePerfLite } from './hooks/usePerfLite';
import { useStaticBackground } from './hooks/useStaticBackground';
import './components/three/SingularityCanvas.css';
import { Skeleton } from './components/ui/Skeleton';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { LoginPage } from './pages/LoginPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import { SignupPage } from './pages/SignupPage';
import { VerifyEmailPage } from './pages/VerifyEmailPage';

const SingularityCanvas = lazy(() =>
  import('./components/three/SingularityCanvas').then((module) => ({
    default: module.SingularityCanvas,
  })),
);

const LandingPage = lazy(() =>
  import('./pages/LandingPage').then((module) => ({ default: module.LandingPage })),
);
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
const AccountPage = lazy(() =>
  import('./pages/AccountPage').then((module) => ({ default: module.AccountPage })),
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
        to="/app"
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

/* Gate barato: decide ANTES de baixar o chunk three-vendor (~880 kB).
   Todas as condições de bail usam hooks standalone — nada do ecossistema
   three entra nesse arquivo. Elegível → o Suspense mostra o fallback
   estático enquanto o chunk chega (progressive enhancement).
   O CSS do canvas/fallback é importado estaticamente acima justamente
   pra que o fallback renderize estilizado sem o bundle 3D. */
function SingularityGate() {
  const perfLite = usePerfLite();
  const bgStatic = useStaticBackground();
  const reducedMotion = usePrefersReducedMotion();
  const gpuTier = useGpuTier();

  const ineligible =
    reducedMotion || isTouchLikeEnvironment() || bgStatic || perfLite || gpuTier === 'low';

  if (ineligible) {
    return <div className="singularity-fallback" aria-hidden="true" />;
  }

  return (
    <Suspense fallback={<div className="singularity-fallback" aria-hidden="true" />}>
      <SingularityCanvas />
    </Suspense>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        {/* Fundo Gargantua — canvas fixed global, visível em rotas públicas e no app. */}
        <SingularityGate />
        <Routes>
          {/* ─── Rotas públicas ─── */}
          <Route
            path="/"
            element={
              <Suspense fallback={<PageFallback />}>
                <LandingPage />
              </Suspense>
            }
          />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/verify-email" element={<VerifyEmailPage />} />

          {/* ─── App autenticado (prefixo /app) ─── */}
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
                path="/app"
                element={
                  <Suspense fallback={<PageFallback />}>
                    <ExamListPage />
                  </Suspense>
                }
              />
              <Route
                path="/app/exam/:id"
                element={
                  <Suspense fallback={<PageFallback />}>
                    <ExamDetailPage />
                  </Suspense>
                }
              />
              <Route
                path="/app/exam/:id/review"
                element={
                  <Suspense fallback={<PageFallback />}>
                    <ExamReviewPage />
                  </Suspense>
                }
              />
              <Route
                path="/app/quiz/setup/:examId"
                element={
                  <Suspense fallback={<PageFallback />}>
                    <QuizSetupPage />
                  </Suspense>
                }
              />
              <Route
                path="/app/banco"
                element={
                  <Suspense fallback={<PageFallback />}>
                    <BankPage />
                  </Suspense>
                }
              />
              <Route
                path="/app/quiz/:examId"
                element={
                  <Suspense fallback={<PageFallback />}>
                    <QuizPlayerPage />
                  </Suspense>
                }
              />
              <Route
                path="/app/quiz/:quizId/result"
                element={
                  <Suspense fallback={<PageFallback />}>
                    <QuizResultPage />
                  </Suspense>
                }
              />
              <Route
                path="/app/conta"
                element={
                  <Suspense fallback={<PageFallback />}>
                    <AccountPage />
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
