"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import {
  actionFailure,
  actionSuccess,
  zodErrorMap,
  type ActionResult,
} from "@/lib/action-result";
import { getCurrentAdmin } from "@/lib/auth/get-current-admin";
import { db } from "@/db";
import { attemptLeaveEvents, quizAttempts } from "@/db/schema";
import {
  reopenAttemptSchema,
  type ReopenAttemptInput,
} from "@/modules/admin/schemas/access-code";

/**
 * Reopens a lockdown-cancelled attempt: status goes back to in_progress, the
 * leave events are forgiven (so strikes restart at zero), and answers are kept.
 * The overall exam clock is NOT extended; if it already ran out, the student's
 * resume auto-submits as usual.
 */
export async function reopenCancelledAttempt(
  input: ReopenAttemptInput,
): Promise<ActionResult> {
  const admin = await getCurrentAdmin();

  if (!admin.success) {
    return actionFailure(admin.message);
  }

  const parsed = reopenAttemptSchema.safeParse(input);

  if (!parsed.success) {
    return actionFailure("Invalid attempt.", zodErrorMap(parsed.error));
  }

  try {
    await db.transaction(async (tx) => {
      const reopened = await tx
        .update(quizAttempts)
        .set({ status: "in_progress", cancelledAt: null, cancelReason: null })
        .where(
          and(
            eq(quizAttempts.id, parsed.data.attemptId),
            eq(quizAttempts.status, "cancelled"),
          ),
        )
        .returning({ id: quizAttempts.id });

      if (reopened.length === 0) {
        throw new Error("NOT_CANCELLED");
      }

      await tx
        .update(attemptLeaveEvents)
        .set({ forgivenAt: new Date() })
        .where(
          and(
            eq(attemptLeaveEvents.attemptId, parsed.data.attemptId),
            isNull(attemptLeaveEvents.forgivenAt),
          ),
        );
    });
  } catch (error) {
    if (error instanceof Error && error.message === "NOT_CANCELLED") {
      return actionFailure("This attempt is not cancelled.");
    }

    console.error("reopenCancelledAttempt failed:", error);
    return actionFailure("Could not reopen this attempt. Please try again.");
  }

  revalidatePath("/admin/codes");

  return actionSuccess(undefined, "Attempt reopened. The student can resume.");
}
