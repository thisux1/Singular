CREATE TYPE "public"."exam_file_type" AS ENUM('pdf', 'image');--> statement-breakpoint
CREATE TYPE "public"."exam_status" AS ENUM('queued', 'processing', 'completed', 'failed');--> statement-breakpoint
CREATE TABLE "exams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" varchar(500) NOT NULL,
	"original_filename" varchar(500) NOT NULL,
	"file_path" varchar(1000) NOT NULL,
	"file_type" "exam_file_type" NOT NULL,
	"status" "exam_status" DEFAULT 'queued' NOT NULL,
	"error_message" text,
	"total_questions" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "idx_exams_status" ON "exams" USING btree ("status");