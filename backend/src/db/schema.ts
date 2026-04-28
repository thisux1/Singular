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

export const exams = pgTable(
  'exams',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    title: varchar('title', { length: 500 }).notNull(),
    originalFilename: varchar('original_filename', { length: 500 }).notNull(),
    filePath: varchar('file_path', { length: 1000 }).notNull(),
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
    parsingLog: jsonb('parsing_log').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
  },
  (table) => [index('idx_exams_status').on(table.status)],
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
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_questions_content_hash').on(table.contentHash),
    index('idx_questions_subject_topic').on(table.subject, table.topic),
    index('idx_questions_difficulty').on(table.difficulty),
    index('idx_questions_exam_id').on(table.examId),
  ],
);

export const quizSessions = pgTable(
  'quiz_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    examId: uuid('exam_id')
      .notNull()
      .references(() => exams.id, { onDelete: 'cascade' }),
    userId: varchar('user_id', { length: 255 }),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    totalQuestions: integer('total_questions').notNull(),
    correctAnswers: integer('correct_answers').notNull().default(0),
    score: real('score'),
  },
  (table) => [index('idx_quiz_sessions_exam').on(table.examId)],
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

export type ExamRow = typeof exams.$inferSelect;
export type NewExamRow = typeof exams.$inferInsert;
export type QuestionRow = typeof questions.$inferSelect;
export type NewQuestionRow = typeof questions.$inferInsert;
export type QuizSessionRow = typeof quizSessions.$inferSelect;
export type NewQuizSessionRow = typeof quizSessions.$inferInsert;
export type QuizAnswerRow = typeof quizAnswers.$inferSelect;
export type NewQuizAnswerRow = typeof quizAnswers.$inferInsert;
