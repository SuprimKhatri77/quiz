import { and, count, eq, isNull } from "drizzle-orm";

import { db } from "@/db";
import { attemptLeaveEvents, quizAttempts, quizSets } from "@/db/schema";
import { DEADLINE_GRACE_MS, isPastOverallDeadline } from "@/lib/attempt-deadline";
import { evaluateLeave, type LeaveReason } from "@/lib/lockdown";

export type RecordLeaveResult = {
  /** False when lockdown is off, the attempt is no longer in progress, or time already ran out. */
  tracked: boolean;
  strikes: number;
  allowedLeaves: number;
  cancelled: boolean;
};

/**
 * Records a leave and cancels the attempt when strikes exceed the set's
 * allowed leaves. Shared by the report-leave server action and the unload
 * beacon route; the server (not the client) decides what counts and cancels.
 *
 * Runs in one transaction holding a row lock on the attempt, so concurrent
 * reports, submit and an admin reopen are serialised (no lost strikes).
 */
export async function recordLeave(
  attemptId: string,
  { reason, durationMs }: { reason: LeaveReason; durationMs: number | null },
): Promise<RecordLeaveResult | null> {
  return db.transaction(async (tx) => {
    const [attempt] = await tx
      .select({
        id: quizAttempts.id,
        status: quizAttempts.status,
        startedAt: quizAttempts.startedAt,
        quizSetId: quizAttempts.quizSetId,
      })
      .from(quizAttempts)
      .where(eq(quizAttempts.id, attemptId))
      .for("update");

    if (!attempt) {
      return null;
    }

    const [quizSet] = await tx
      .select({
        lockdownEnabled: quizSets.lockdownEnabled,
        allowedLeaves: quizSets.allowedLeaves,
        durationMinutes: quizSets.durationMinutes,
      })
      .from(quizSets)
      .where(eq(quizSets.id, attempt.quizSetId));

    if (!quizSet) {
      return null;
    }

    const { lockdownEnabled, allowedLeaves, durationMinutes } = quizSet;

    if (attempt.status === "cancelled") {
      return {
        tracked: true,
        strikes: allowedLeaves + 1,
        allowedLeaves,
        cancelled: true,
      };
    }

    const notTracked = {
      tracked: false,
      strikes: 0,
      allowedLeaves,
      cancelled: false,
    };

    if (!lockdownEnabled || attempt.status !== "in_progress") {
      return notTracked;
    }

    // Past the deadline the attempt should auto-submit on resume, not be voided
    // by a close/reload after time ran out.
    if (
      isPastOverallDeadline(
        attempt.startedAt,
        durationMinutes,
        new Date(),
        DEADLINE_GRACE_MS,
      )
    ) {
      return notTracked;
    }

    const [{ value: priorStrikes }] = await tx
      .select({ value: count() })
      .from(attemptLeaveEvents)
      .where(
        and(
          eq(attemptLeaveEvents.attemptId, attemptId),
          eq(attemptLeaveEvents.countsAsStrike, true),
          isNull(attemptLeaveEvents.forgivenAt),
        ),
      );

    const evaluation = evaluateLeave({
      reason,
      durationMs,
      currentStrikes: Number(priorStrikes),
      allowedLeaves,
    });

    await tx.insert(attemptLeaveEvents).values({
      id: crypto.randomUUID(),
      attemptId,
      durationMs,
      reason,
      countsAsStrike: evaluation.countsAsStrike,
    });

    if (evaluation.cancelled) {
      await tx
        .update(quizAttempts)
        .set({
          status: "cancelled",
          cancelledAt: new Date(),
          cancelReason: `Left the exam window ${evaluation.strikes} time${evaluation.strikes === 1 ? "" : "s"} (allowed: ${allowedLeaves}).`,
        })
        .where(eq(quizAttempts.id, attemptId));
    }

    return {
      tracked: true,
      strikes: evaluation.strikes,
      allowedLeaves,
      cancelled: evaluation.cancelled,
    };
  });
}
