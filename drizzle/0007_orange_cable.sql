ALTER TYPE "public"."quiz_attempt_status" ADD VALUE 'cancelled';--> statement-breakpoint
CREATE TABLE "attempt_leave_events" (
	"id" text PRIMARY KEY NOT NULL,
	"attempt_id" text NOT NULL,
	"occurred_at" timestamp DEFAULT now() NOT NULL,
	"duration_ms" integer,
	"reason" text NOT NULL,
	"counts_as_strike" boolean NOT NULL,
	"forgiven_at" timestamp,
	CONSTRAINT "attempt_leave_events_reason_valid" CHECK ("attempt_leave_events"."reason" IN ('hidden', 'blur', 'fullscreen_exit', 'unload'))
);
--> statement-breakpoint
ALTER TABLE "quiz_attempts" DROP CONSTRAINT "quiz_attempts_completed_consistency";--> statement-breakpoint
ALTER TABLE "quiz_attempts" ADD COLUMN "cancelled_at" timestamp;--> statement-breakpoint
ALTER TABLE "quiz_attempts" ADD COLUMN "cancel_reason" text;--> statement-breakpoint
ALTER TABLE "quiz_sets" ADD COLUMN "lockdown_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "quiz_sets" ADD COLUMN "allowed_leaves" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "attempt_leave_events" ADD CONSTRAINT "attempt_leave_events_attempt_id_quiz_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."quiz_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attempt_leave_events_attempt_id_idx" ON "attempt_leave_events" USING btree ("attempt_id");--> statement-breakpoint
ALTER TABLE "quiz_attempts" ADD CONSTRAINT "quiz_attempts_completed_consistency" CHECK (("quiz_attempts"."status"::text = 'in_progress' AND "quiz_attempts"."completed_at" IS NULL AND "quiz_attempts"."cancelled_at" IS NULL) OR ("quiz_attempts"."status"::text = 'completed' AND "quiz_attempts"."completed_at" IS NOT NULL AND "quiz_attempts"."cancelled_at" IS NULL) OR ("quiz_attempts"."status"::text = 'cancelled' AND "quiz_attempts"."cancelled_at" IS NOT NULL AND "quiz_attempts"."completed_at" IS NULL));--> statement-breakpoint
ALTER TABLE "quiz_sets" ADD CONSTRAINT "quiz_sets_allowed_leaves_range" CHECK ("quiz_sets"."allowed_leaves" >= 0 AND "quiz_sets"."allowed_leaves" <= 10);