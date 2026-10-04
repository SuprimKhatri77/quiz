"use server";

import { and, eq } from "drizzle-orm";

import {
  actionFailure,
  actionSuccess,
  zodErrorMap,
  type ActionResult,
} from "@/lib/action-result";
import { isPastOverallDeadline } from "@/lib/attempt-deadline";
import { isQuestionExpired, QUESTION_SAVE_GRACE_MS } from "@/lib/question-timer";
import { db } from "@/db";
import {
  attemptQuestionStates,
  options,
  questions,
  quizAttempts,
} from "@/db/schema";
import {
  saveAnswerSchema,
  type SaveAnswerInput,
} from "@/modules/quiz/schemas/attempt";

/**
 * Saves the selected option for a timed question. This is the server-side
 * authority for "was it answered in time": a save after the question's timer
 * (or the overall deadline) is rejected, and submit only trusts what was saved
 * here for timed questions.
 */
export async function saveAnswer(
  input: SaveAnswerInput,
): Promise<ActionResult<{ questionId: string; optionId: string }>> {
  const parsed = saveAnswerSchema.safeParse(input);

  if (!parsed.success) {
    return actionFailure("Unable to save this answer.", zodErrorMap(parsed.error));
  }

  const { attemptId, questionId, optionId } = parsed.data;

  const attempt = await db.query.quizAttempts.findFirst({
    where: eq(quizAttempts.id, attemptId),
    columns: { id: true, status: true, startedAt: true },
    with: { quizSet: { columns: { durationMinutes: true } } },
  });

  if (attempt?.status === "cancelled") {
    return actionFailure("This attempt was cancelled.", {
      reason: "cancelled",
    });
  }

  if (!attempt || attempt.status !== "in_progress") {
    return actionFailure("This attempt is no longer active.", {
      reason: "attempt_over",
    });
  }

  const now = new Date();

  if (
    isPastOverallDeadline(
      attempt.startedAt,
      attempt.quizSet.durationMinutes,
      now,
      QUESTION_SAVE_GRACE_MS,
    )
  ) {
    return actionFailure("Time is up for this attempt.", {
      reason: "attempt_over",
    });
  }

  const [row] = await db
    .select({
      startedAt: attemptQuestionStates.startedAt,
      timeLimitSeconds: questions.timeLimitSeconds,
    })
    .from(attemptQuestionStates)
    .innerJoin(questions, eq(attemptQuestionStates.questionId, questions.id))
    .where(
      and(
        eq(attemptQuestionStates.attemptId, attemptId),
        eq(attemptQuestionStates.questionId, questionId),
      ),
    )
    .limit(1);

  if (!row || row.timeLimitSeconds === null) {
    return actionFailure("Start this question before answering it.", {
      reason: "not_started",
    });
  }

  if (
    isQuestionExpired(row.startedAt, row.timeLimitSeconds, now, QUESTION_SAVE_GRACE_MS)
  ) {
    return actionFailure("Time is up for this question.", {
      reason: "expired",
    });
  }

  const [option] = await db
    .select({ id: options.id })
    .from(options)
    .where(and(eq(options.id, optionId), eq(options.questionId, questionId)))
    .limit(1);

  if (!option) {
    return actionFailure("That option does not belong to this question.");
  }

  await db
    .update(attemptQuestionStates)
    .set({ selectedOptionId: optionId, answeredAt: now })
    .where(
      and(
        eq(attemptQuestionStates.attemptId, attemptId),
        eq(attemptQuestionStates.questionId, questionId),
      ),
    );

  return actionSuccess({ questionId, optionId });
}
