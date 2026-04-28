import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Route, Routes } from 'react-router';
import { AppShell } from './components/layout/AppShell';
import { ExamDetailPage } from './pages/ExamDetailPage';
import { ExamListPage } from './pages/ExamListPage';
import { ExamReviewPage } from './pages/ExamReviewPage';
import { QuizPlayerPage } from './pages/QuizPlayerPage';
import { QuizResultPage } from './pages/QuizResultPage';

const queryClient = new QueryClient();

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<ExamListPage />} />
            <Route path="/exam/:id" element={<ExamDetailPage />} />
            <Route path="/exam/:id/review" element={<ExamReviewPage />} />
            <Route path="/quiz/:examId" element={<QuizPlayerPage />} />
            <Route path="/quiz/:quizId/result" element={<QuizResultPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
