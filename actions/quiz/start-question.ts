"use server";

import { and, asc, eq } from "drizzle-orm";

import {
  actionFailure,
  actionSuccess,
  zodErrorMap,
  type ActionResult,
} from "@/lib/action-result";
import { isPastOverallDeadline } from "@/lib/attempt-deadline";
import { db } from "@/db";
import {
  attemptQuestionStates,
  options,
  questions,
  quizAttempts,
  quizSections,
} from "@/db/schema";
import type { PublicQuizQuestionContent } from "@/dal/public/get-quiz-set";
import {
  startQuestionSchema,
  type StartQuestionInput,
} from "@/modules/quiz/schemas/attempt";

export type StartQuestionResult = {
  questionId: string;
  timeLimitSeconds: number;
  /** Server-side start of this question's timer (ISO). */
  startedAt: string;
  /** Server clock at response time (ISO) — lets the client correct for skew. */
  serverNow: string;
  content: PublicQuizQuestionContent;
};

/**
 * Starts (or re-opens) a timed question. The timer start is recorded once, so
 * re-opening, refreshing or using a second tab never restarts the countdown.
 */
export async function startQuestion(
  input: StartQuestionInput,
): Promise<ActionResult<StartQuestionResult>> {
  const parsed = startQuestionSchema.safeParse(input);

  if (!parsed.success) {
    return actionFailure(
      "Unable to start this question.",
      zodErrorMap(parsed.error),
    );
  }

  const { attemptId, questionId } = parsed.data;

  const attempt = await db.query.quizAttempts.findFirst({
    where: eq(quizAttempts.id, attemptId),
    columns: { id: true, quizSetId: true, status: true, startedAt: true },
    with: { quizSet: { columns: { durationMinutes: true, isPublished: true } } },
  });

  if (attempt?.status === "cancelled") {
    return actionFailure("This attempt was cancelled.", {
      reason: "cancelled",
    });
  }

  if (
    !attempt ||
    attempt.status !== "in_progress" ||
    !attempt.quizSet.isPublished
  ) {
    return actionFailure("This attempt is no longer active.", {
      reason: "attempt_over",
    });
  }

  const now = new Date();

  // No grace on starting: a question can't begin after the exam clock ran out.
  if (isPastOverallDeadline(attempt.startedAt, attempt.quizSet.durationMinutes, now, 0)) {
    return actionFailure("Time is up for this attempt.", {
      reason: "attempt_over",
    });
  }

  const [question] = await db
    .select({
      id: questions.id,
      prompt: questions.prompt,
      timeLimitSeconds: questions.timeLimitSeconds,
    })
    .from(questions)
    .innerJoin(quizSections, eq(questions.quizSectionId, quizSections.id))
    .where(
      and(
        eq(questions.id, questionId),
        eq(quizSections.quizSetId, attempt.quizSetId),
      ),
    )
    .limit(1);

  if (!question) {
    return actionFailure("Question not found in this quiz.");
  }

  if (question.timeLimitSeconds === null) {
    return actionFailure("This question is not timed.");
  }

  await db
    .insert(attemptQuestionStates)
    .values({
      id: crypto.randomUUID(),
      attemptId,
      questionId,
      startedAt: now,
    })
    .onConflictDoNothing({
      target: [attemptQuestionStates.attemptId, attemptQuestionStates.questionId],
    });

  const [state] = await db
    .select({ startedAt: attemptQuestionStates.startedAt })
    .from(attemptQuestionStates)
    .where(
      and(
        eq(attemptQuestionStates.attemptId, attemptId),
        eq(attemptQuestionStates.questionId, questionId),
      ),
    )
    .limit(1);

  if (!state) {
    return actionFailure("Could not start this question. Please try again.");
  }

  const optionRows = await db
    .select({
      id: options.id,
      label: options.label,
      position: options.position,
    })
    .from(options)
    .where(eq(options.questionId, questionId))
    .orderBy(asc(options.position));

  return actionSuccess({
    questionId,
    timeLimitSeconds: question.timeLimitSeconds,
    startedAt: state.startedAt.toISOString(),
    serverNow: new Date().toISOString(),
    content: { prompt: question.prompt, options: optionRows },
  });
}
