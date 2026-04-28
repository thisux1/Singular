import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { examsRoutes } from './routes/exams.js';
import { quizRoutes } from './routes/quiz.js';
import { questionsRoutes } from './routes/questions.js';
import { config } from './config.js';
import { logInfo } from './utils/logger.js';

const app = new Hono();

app.use('/api/*', cors({ origin: '*' }));
app.get('/health', (c) => c.json({ ok: true }));
app.route('/api/exams', examsRoutes);
app.route('/api/quiz', quizRoutes);
app.route('/api/questions', questionsRoutes);

serve(
  {
    fetch: app.fetch,
    port: config.port,
  },
  (info) => {
    logInfo('api.started', { port: info.port });
  },
);

export default app;
