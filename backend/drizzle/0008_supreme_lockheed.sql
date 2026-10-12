ALTER TABLE "exams" ADD COLUMN "banca" varchar(120);--> statement-breakpoint
ALTER TABLE "exams" ADD COLUMN "kind" varchar(16) DEFAULT 'exam' NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_exams_banca" ON "exams" USING btree ("banca");--> statement-breakpoint
CREATE INDEX "idx_exams_user_kind" ON "exams" USING btree ("user_id","kind");