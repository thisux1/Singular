CREATE TYPE "public"."difficulty" AS ENUM('easy', 'medium', 'hard');--> statement-breakpoint
CREATE TABLE "questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"exam_id" uuid NOT NULL,
	"order" integer NOT NULL,
	"question_text" text NOT NULL,
	"context_text" text,
	"options" jsonb NOT NULL,
	"correct_answer" varchar(10),
	"explanation" text,
	"explanation_steps" jsonb,
	"common_mistakes" jsonb,
	"subject" varchar(100),
	"topic" varchar(200),
	"difficulty" "difficulty",
	"confidence" real,
	"content_hash" varchar(64) NOT NULL,
	"source_page" integer,
	"has_image" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quiz_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"selected_answer" varchar(10) NOT NULL,
	"is_correct" boolean NOT NULL,
	"time_spent_ms" integer,
	"answered_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quiz_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"exam_id" uuid NOT NULL,
	"user_id" varchar(255),
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"total_questions" integer NOT NULL,
	"correct_answers" integer DEFAULT 0 NOT NULL,
	"score" real
);
--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_exam_id_exams_id_fk" FOREIGN KEY ("exam_id") REFERENCES "public"."exams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_answers" ADD CONSTRAINT "quiz_answers_session_id_quiz_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."quiz_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_answers" ADD CONSTRAINT "quiz_answers_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_sessions" ADD CONSTRAINT "quiz_sessions_exam_id_exams_id_fk" FOREIGN KEY ("exam_id") REFERENCES "public"."exams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_questions_content_hash" ON "questions" USING btree ("content_hash");--> statement-breakpoint
CREATE INDEX "idx_questions_subject_topic" ON "questions" USING btree ("subject","topic");--> statement-breakpoint
CREATE INDEX "idx_questions_difficulty" ON "questions" USING btree ("difficulty");--> statement-breakpoint
CREATE INDEX "idx_questions_exam_id" ON "questions" USING btree ("exam_id");--> statement-breakpoint
CREATE INDEX "idx_quiz_answers_session" ON "quiz_answers" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_quiz_answers_session_question" ON "quiz_answers" USING btree ("session_id","question_id");--> statement-breakpoint
CREATE INDEX "idx_quiz_sessions_exam" ON "quiz_sessions" USING btree ("exam_id");