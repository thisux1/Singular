ALTER TYPE "public"."exam_status" ADD VALUE 'reviewing' BEFORE 'completed';--> statement-breakpoint
ALTER TABLE "exams" ADD COLUMN "page_offset" integer;--> statement-breakpoint
ALTER TABLE "exams" ADD COLUMN "gabarito_path" varchar(1000);--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "gabarito_matched" boolean DEFAULT false NOT NULL;