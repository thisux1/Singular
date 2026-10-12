-- 0006: tabelas Better Auth + ownership user_id (D6) + colunas v1.0.
-- Editado manualmente sobre o output do drizzle-kit: colunas user_id nascem
-- NULLABLE → seed do usuário "system" → backfill das linhas legadas →
-- SET NOT NULL. Sem isso o SQL gerado falharia em DBs com dados existentes.

CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean NOT NULL,
	"image" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
-- Ownership: nasce nullable para permitir backfill.
ALTER TABLE "exams" ADD COLUMN "user_id" text;--> statement-breakpoint
ALTER TABLE "quiz_sessions" ALTER COLUMN "user_id" SET DATA TYPE text;--> statement-breakpoint
-- Seed do usuário que absorve os dados legados (TRD §6 / SCHEMA 1.2).
INSERT INTO "user" ("id", "name", "email", "email_verified", "created_at", "updated_at")
VALUES ('system', 'System', 'system@singular.local', false, now(), now())
ON CONFLICT DO NOTHING;--> statement-breakpoint
UPDATE "exams" SET "user_id" = 'system' WHERE "user_id" IS NULL;--> statement-breakpoint
UPDATE "quiz_sessions" SET "user_id" = 'system' WHERE "user_id" IS NULL;--> statement-breakpoint
ALTER TABLE "exams" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "quiz_sessions" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "exams" ADD COLUMN "file_key" varchar(500);--> statement-breakpoint
ALTER TABLE "exams" ADD COLUMN "gabarito_key" varchar(500);--> statement-breakpoint
ALTER TABLE "exams" ADD COLUMN "file_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "annulled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "requires_pdf" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "quiz_sessions" ADD COLUMN "mode" varchar(16);--> statement-breakpoint
ALTER TABLE "quiz_sessions" ADD COLUMN "mode_params" jsonb;--> statement-breakpoint
ALTER TABLE "quiz_sessions" ADD COLUMN "total_time_ms" integer;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_account_user_id" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_session_user_id" ON "session" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "exams" ADD CONSTRAINT "exams_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_sessions" ADD CONSTRAINT "quiz_sessions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_exams_user_status" ON "exams" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "idx_exams_file_hash" ON "exams" USING btree ("file_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_questions_exam_order" ON "questions" USING btree ("exam_id","order");--> statement-breakpoint
CREATE INDEX "idx_quiz_sessions_user_exam" ON "quiz_sessions" USING btree ("user_id","exam_id");
