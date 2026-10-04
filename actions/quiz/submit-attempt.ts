"use server";

import { and, eq, inArray } from "drizzle-orm";

import {
  actionFailure,
  actionSuccess,
  isUniqueViolation,
  zodErrorMap,
  type ActionResult,
} from "@/lib/action-result";
import { db } from "@/db";
import {
  attemptAnswers,
  attemptQuestionStates,
  options,
  questions,
  quizAttempts,
  quizSections,
} from "@/db/schema";
import { DEADLINE_GRACE_MS, isPastOverallDeadline } from "@/lib/attempt-deadline";
import {
  submitAttemptSchema,
  type SubmitAttemptInput,
} from "@/modules/quiz/schemas/attempt";

export type SubmitSectionResult = {
  sectionId: string;
  subjectName: string;
  score: number;
  fullMarks: number;
};

export type SubmitAttemptResult = {
  attemptId: string;
  score: number;
  maxScore: number;
  percentage: number;
  sections: SubmitSectionResult[];
};

export async function submitAttempt(
  input: SubmitAttemptInput,
): Promise<ActionResult<SubmitAttemptResult>> {
  const parsed = submitAttemptSchema.safeParse(input);

  if (!parsed.success) {
    return actionFailure(
      "Unable to submit this attempt.",
      zodErrorMap(parsed.error),
    );
  }

  const { attemptId, answers } = parsed.data;

  const attempt = await db.query.quizAttempts.findFirst({
    where: eq(quizAttempts.id, attemptId),
    columns: {
      id: true,
      quizSetId: true,
      status: true,
      maxScore: true,
      startedAt: true,
    },
    with: {
      quizSet: {
        columns: {
          durationMinutes: true,
          isFreeMock: true,
        },
      },
    },
  });

  if (!attempt) {
    return actionFailure("Attempt not found.");
  }

  if (attempt.status !== "in_progress") {
    return actionFailure("This attempt has already been submitted.");
  }

  const now = new Date();
  const pastDeadline = isPastOverallDeadline(
    attempt.startedAt,
    attempt.quizSet.durationMinutes,
    now,
    DEADLINE_GRACE_MS,
  );

  // Server deadline is the only timer authority — ignore client timedOut for auth.
  // The client's timedOut flag only counts once the server clock agrees the
  // deadline has passed (no grace), so the auto-submit isn't refused for the
  // whole grace window. The flag alone never grants partial submit.
  const reachedDeadline =
    parsed.data.timedOut === true &&
    isPastOverallDeadline(
      attempt.startedAt,
      attempt.quizSet.durationMinutes,
      now,
      0,
    );
  const allowPartial =
    attempt.quizSet.isFreeMock || pastDeadline || reachedDeadline;

  const sections = await db.query.quizSections.findMany({
    where: eq(quizSections.quizSetId, attempt.quizSetId),
    orderBy: (table, { asc: orderAsc }) => [orderAsc(table.position)],
    with: {
      subject: {
        columns: {
          name: true,
        },
      },
      questions: {
        columns: {
          id: true,
          marks: true,
          timeLimitSeconds: true,
        },
        with: {
          options: {
            columns: {
              id: true,
              isCorrect: true,
            },
          },
        },
      },
    },
  });

  const questionIds = sections.flatMap((section) =>
    section.questions.map((question) => question.id),
  );

  if (questionIds.length === 0) {
    return actionFailure("This quiz set has no questions.");
  }

  // Timed questions: only the answer saved server-side while the timer ran
  // counts — client-supplied answers for them are ignored. Untimed questions
  // still come from the client.
  const stateRows = await db
    .select({
      questionId: attemptQuestionStates.questionId,
      startedAt: attemptQuestionStates.startedAt,
      selectedOptionId: attemptQuestionStates.selectedOptionId,
    })
    .from(attemptQuestionStates)
    .where(eq(attemptQuestionStates.attemptId, attemptId));
  const stateByQuestionId = new Map(
    stateRows.map((row) => [row.questionId, row]),
  );

  const effectiveAnswers: Record<string, string> = {};
  // Timed questions are skippable: unanswered ones never block submitting.
  const excusedQuestionIds = new Set<string>();

  for (const section of sections) {
    for (const question of section.questions) {
      if (question.timeLimitSeconds === null) {
        const clientAnswer = answers[question.id];
        if (clientAnswer) {
          effectiveAnswers[question.id] = clientAnswer;
        }
        continue;
      }

      const state = stateByQuestionId.get(question.id);

      if (state?.selectedOptionId) {
        effectiveAnswers[question.id] = state.selectedOptionId;
      } else {
        excusedQuestionIds.add(question.id);
      }
    }
  }

  if (!allowPartial) {
    const unanswered = questionIds.filter(
      (questionId) =>
        !effectiveAnswers[questionId] && !excusedQuestionIds.has(questionId),
    );

    if (unanswered.length > 0) {
      return actionFailure(
        `Answer all questions before submitting (${unanswered.length} left).`,
      );
    }

    if (Object.keys(effectiveAnswers).length === 0) {
      return actionFailure("Submit at least one answer.");
    }
  }

  const answeredOptionIds = [
    ...new Set(
      questionIds
        .map((questionId) => effectiveAnswers[questionId])
        .filter((value): value is string => Boolean(value)),
    ),
  ];

  const optionById = new Map<
    string,
    { id: string; questionId: string; isCorrect: boolean }
  >();

  if (answeredOptionIds.length > 0) {
    const optionRows = await db
      .select({
        id: options.id,
        questionId: options.questionId,
        isCorrect: options.isCorrect,
      })
      .from(options)
      .innerJoin(questions, eq(options.questionId, questions.id))
      .innerJoin(quizSections, eq(questions.quizSectionId, quizSections.id))
      .where(
        and(
          inArray(options.id, answeredOptionIds),
          eq(quizSections.quizSetId, attempt.quizSetId),
        ),
      );

    for (const row of optionRows) {
      optionById.set(row.id, row);
    }
  }

  const answerRows: {
    id: string;
    attemptId: string;
    questionId: string;
    optionId: string;
    isCorrect: boolean;
  }[] = [];

  for (const questionId of questionIds) {
    const optionId = effectiveAnswers[questionId];
    if (!optionId) {
      continue;
    }

    const option = optionById.get(optionId);

    if (!option || option.questionId !== questionId) {
      return actionFailure("One or more answers are invalid for this quiz.");
    }

    answerRows.push({
      id: crypto.randomUUID(),
      attemptId,
      questionId,
      optionId,
      isCorrect: option.isCorrect,
    });
  }

  const sectionResults: SubmitSectionResult[] = sections.map((section) => {
    let score = 0;

    for (const question of section.questions) {
      const selectedId = effectiveAnswers[question.id];
      if (!selectedId) {
        continue;
      }
      const selected = optionById.get(selectedId);
      if (selected?.isCorrect) {
        score += question.marks;
      }
    }

    return {
      sectionId: section.id,
      subjectName: section.subject.name,
      score,
      fullMarks: section.fullMarks,
    };
  });

  const score = Math.min(
    sectionResults.reduce((sum, section) => sum + section.score, 0),
    attempt.maxScore,
  );
  const completedAt = new Date();

  try {
    await db.transaction(async (tx) => {
      const updated = await tx
        .update(quizAttempts)
        .set({
          status: "completed",
          score,
          completedAt,
        })
        .where(
          and(
            eq(quizAttempts.id, attemptId),
            eq(quizAttempts.status, "in_progress"),
          ),
        )
        .returning({ id: quizAttempts.id });

      if (updated.length === 0) {
        throw new Error("ATTEMPT_ALREADY_COMPLETED");
      }

      if (answerRows.length > 0) {
        await tx.insert(attemptAnswers).values(answerRows);
      }
    });
  } catch (error) {
    if (
      (error instanceof Error &&
        error.message === "ATTEMPT_ALREADY_COMPLETED") ||
      isUniqueViolation(error)
    ) {
      return actionFailure("This attempt has already been submitted.");
    }

    throw error;
  }

  return actionSuccess({
    attemptId,
    score,
    maxScore: attempt.maxScore,
    percentage: Math.round((score / attempt.maxScore) * 100),
    sections: sectionResults,
  });
}
