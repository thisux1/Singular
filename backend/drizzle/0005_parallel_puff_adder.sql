CREATE TYPE "public"."extraction_tier" AS ENUM('fastpath', 'repair', 'gemini');--> statement-breakpoint
ALTER TABLE "exams" ADD COLUMN "extraction_tier" "extraction_tier";--> statement-breakpoint
ALTER TABLE "exams" ADD COLUMN "parsing_log" jsonb;