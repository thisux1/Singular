import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

export const examFileTypeEnum = pgEnum('exam_file_type', ['pdf', 'image']);
export const examStatusEnum = pgEnum('exam_status', ['queued', 'processing', 'reviewing', 'completed', 'failed']);
export const extractionTierEnum = pgEnum('extraction_tier', ['fastpath', 'repair', 'gemini']);
export const difficultyEnum = pgEnum('difficulty', ['easy', 'medium', 'hard']);
export const classificationStatusEnum = pgEnum('classification_status', ['pending', 'classified', 'failed']);

// ---------------------------------------------------------------------------
// Better Auth tables (D6) — shape conforme @better-auth/core 1.7.x
// (id/createdAt/updatedAt obrigatórios em todas; userId FK cascade + índice).
// ---------------------------------------------------------------------------

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull(),
  image: text('image'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

export const session = pgTable(
  'session',
  {
    id: text('id').primaryKey(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    token: text('token').notNull().unique(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [index('idx_session_user_id').on(table.userId)],
);

export const account = pgTable(
  'account',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
    scope: text('scope'),
    password: text('password'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => [index('idx_account_user_id').on(table.userId)],
);

export const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
});

// ---------------------------------------------------------------------------
// Domain tables
// ---------------------------------------------------------------------------

export const exams = pgTable(
  'exams',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // default 'system' — inserts que ainda não propagam req.user caem no mesmo
    // bucket do backfill legado; WS-A passa a setar userId explicitamente.
    userId: text('user_id')
      .notNull()
      .default('system')
      .references(() => user.id, { onDelete: 'cascade' }),
    title: varchar('title', { length: 500 }).notNull(),
    originalFilename: varchar('original_filename', { length: 500 }).notNull(),
    filePath: varchar('file_path', { length: 1000 }).notNull(),
    fileKey: varchar('file_key', { length: 500 }),
    gabaritoKey: varchar('gabarito_key', { length: 500 }),
    fileHash: varchar('file_hash', { length: 64 }),
    fileType: examFileTypeEnum('file_type').notNull(),
    status: examStatusEnum('status').notNull().default('queued'),
    errorMessage: text('error_message'),
    totalQuestions: integer('total_questions'),
    pageOffset: integer('page_offset'),
    pageStart: integer('page_start'),
    pageEnd: integer('page_end'),
    provaType: varchar('prova_type', { length: 16 }),
    cargoTemplateId: varchar('cargo_template_id', { length: 100 }),
    edital: varchar('edital', { length: 500 }),
    examDate: varchar('exam_date', { length: 50 }),
    gabaritoPath: varchar('gabarito_path', { length: 1000 }),
    extractionTier: extractionTierEnum('extraction_tier'),
    // Banca organizadora (Cesgranrio, FCC, Cebraspe...) — vem do multipart 'banca'.
    banca: varchar('banca', { length: 120 }),
    // 'exam' = prova upada; 'bank' = prova sintética do banco de questões (T3).
    kind: varchar('kind', { length: 16 }).notNull().default('exam').$type<'exam' | 'bank'>(),
    parsingLog: jsonb('parsing_log').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
  },
  (table) => [
    index('idx_exams_status').on(table.status),
    index('idx_exams_user_status').on(table.userId, table.status),
    index('idx_exams_file_hash').on(table.fileHash),
    index('idx_exams_banca').on(table.banca),
    index('idx_exams_user_kind').on(table.userId, table.kind),
  ],
);

export const questions = pgTable(
  'questions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    examId: uuid('exam_id')
      .notNull()
      .references(() => exams.id, { onDelete: 'cascade' }),
    order: integer('order').notNull(),
    questionText: text('question_text').notNull(),
    contextText: text('context_text'),
    options: jsonb('options').$type<string[]>().notNull(),
    correctAnswer: varchar('correct_answer', { length: 10 }),
    explanation: text('explanation'),
    explanationSteps: jsonb('explanation_steps').$type<string[]>(),
    commonMistakes: jsonb('common_mistakes').$type<string[]>(),
    subject: varchar('subject', { length: 100 }),
    topic: varchar('topic', { length: 200 }),
    difficulty: difficultyEnum('difficulty'),
    classificationStatus: classificationStatusEnum('classification_status').notNull().default('pending'),
    confidence: real('confidence'),
    contentHash: varchar('content_hash', { length: 64 }).notNull(),
    sourcePage: integer('source_page'),
    gabaritoMatched: boolean('gabarito_matched').notNull().default(false),
    hasImage: boolean('has_image').notNull().default(false),
    annulled: boolean('annulled').notNull().default(false),
    requiresPdf: boolean('requires_pdf').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_questions_content_hash').on(table.contentHash),
    index('idx_questions_subject_topic').on(table.subject, table.topic),
    index('idx_questions_difficulty').on(table.difficulty),
    index('idx_questions_exam_id').on(table.examId),
    uniqueIndex('uq_questions_exam_order').on(table.examId, table.order),
  ],
);

export const quizSessions = pgTable(
  'quiz_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    examId: uuid('exam_id')
      .notNull()
      .references(() => exams.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .default('system')
      .references(() => user.id, { onDelete: 'cascade' }),
    mode: varchar('mode', { length: 16 }),
    modeParams: jsonb('mode_params').$type<Record<string, unknown>>(),
    totalTimeMs: integer('total_time_ms'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    totalQuestions: integer('total_questions').notNull(),
    correctAnswers: integer('correct_answers').notNull().default(0),
    score: real('score'),
  },
  (table) => [
    index('idx_quiz_sessions_exam').on(table.examId),
    index('idx_quiz_sessions_user_exam').on(table.userId, table.examId),
  ],
);

export const quizAnswers = pgTable(
  'quiz_answers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => quizSessions.id, { onDelete: 'cascade' }),
    questionId: uuid('question_id')
      .notNull()
      .references(() => questions.id, { onDelete: 'cascade' }),
    selectedAnswer: varchar('selected_answer', { length: 10 }).notNull(),
    isCorrect: boolean('is_correct').notNull(),
    timeSpentMs: integer('time_spent_ms'),
    answeredAt: timestamp('answered_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_quiz_answers_session').on(table.sessionId),
    uniqueIndex('uq_quiz_answers_session_question').on(table.sessionId, table.questionId),
  ],
);

export type UserRow = typeof user.$inferSelect;
export type NewUserRow = typeof user.$inferInsert;
export type ExamRow = typeof exams.$inferSelect;
export type NewExamRow = typeof exams.$inferInsert;
export type QuestionRow = typeof questions.$inferSelect;
export type NewQuestionRow = typeof questions.$inferInsert;
export type QuizSessionRow = typeof quizSessions.$inferSelect;
export type NewQuizSessionRow = typeof quizSessions.$inferInsert;
export type QuizAnswerRow = typeof quizAnswers.$inferSelect;
export type NewQuizAnswerRow = typeof quizAnswers.$inferInsert;
