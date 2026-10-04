CREATE TABLE "attempt_question_states" (
	"id" text PRIMARY KEY NOT NULL,
	"attempt_id" text NOT NULL,
	"question_id" text NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"selected_option_id" text,
	"answered_at" timestamp,
	CONSTRAINT "attempt_question_states_attempt_id_question_id_uid" UNIQUE("attempt_id","question_id")
);
--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "time_limit_seconds" integer;--> statement-breakpoint
ALTER TABLE "attempt_question_states" ADD CONSTRAINT "attempt_question_states_attempt_id_quiz_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."quiz_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attempt_question_states" ADD CONSTRAINT "attempt_question_states_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attempt_question_states" ADD CONSTRAINT "attempt_question_states_selected_option_id_options_id_fk" FOREIGN KEY ("selected_option_id") REFERENCES "public"."options"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attempt_question_states_attempt_id_idx" ON "attempt_question_states" USING btree ("attempt_id");--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_time_limit_positive" CHECK ("questions"."time_limit_seconds" IS NULL OR "questions"."time_limit_seconds" > 0);