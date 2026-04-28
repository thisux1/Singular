ALTER TABLE "exams" ADD COLUMN "page_start" integer;--> statement-breakpoint
ALTER TABLE "exams" ADD COLUMN "page_end" integer;--> statement-breakpoint
ALTER TABLE "exams" ADD COLUMN "prova_type" varchar(16);--> statement-breakpoint
ALTER TABLE "exams" ADD COLUMN "cargo_template_id" varchar(100);--> statement-breakpoint
ALTER TABLE "exams" ADD COLUMN "edital" varchar(500);--> statement-breakpoint
ALTER TABLE "exams" ADD COLUMN "exam_date" varchar(50);