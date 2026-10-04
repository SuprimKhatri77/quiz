"use server";

import { and, eq } from "drizzle-orm";

import {
  actionFailure,
  actionSuccess,
  isUniqueViolation,
  zodErrorMap,
  type ActionResult,
} from "@/lib/action-result";
import {
  formatParticipantName,
  normalizeParticipantNameKey,
} from "@/lib/participant-name";
import { db } from "@/db";
import {
  accessCodes,
  quizAttempts,
  quizSections,
  quizSets,
} from "@/db/schema";
import {
  getPublishedQuizQuestionsForAttempt,
  type PublicQuizSection,
} from "@/dal/public/get-quiz-set";
import { isPastOverallDeadline, overallDeadlineAt } from "@/lib/attempt-deadline";
import {
  startAttemptSchema,
  type StartAttemptInput,
} from "@/modules/quiz/schemas/attempt";

export type StartAttemptResult = {
  attemptId: string;
  resumed: boolean;
  completed?: boolean;
  /** Lockdown cancelled this attempt (void until an admin reopens it). */
  cancelled?: boolean;
  /** In-progress attempt whose timer already expired — client should submit. */
  deadlineExpired?: boolean;
  startedAt?: string;
  /** Server clock (ISO) so the client can correct for clock skew. */
  serverNow?: string;
  durationMinutes?: number;
  deadlineAt?: string;
  /** Take payload — omitted when redirecting to results or auto-submitting. */
  sections?: PublicQuizSection[];
};

const CANCELLED_MESSAGE =
  "This attempt was cancelled because the exam window was left. Contact your administrator.";

function cancelledResult(attemptId: string) {
  return actionSuccess(
    { attemptId, resumed: false, cancelled: true },
    CANCELLED_MESSAGE,
  );
}

function deadlinePayload(startedAt: Date, durationMinutes: number) {
  const deadlineAt = overallDeadlineAt(startedAt, durationMinutes);
  return {
    startedAt: startedAt.toISOString(),
    serverNow: new Date().toISOString(),
    durationMinutes,
    deadlineAt: deadlineAt.toISOString(),
  };
}

function isPastDeadline(startedAt: Date, durationMinutes: number, now: Date) {
  return isPastOverallDeadline(startedAt, durationMinutes, now);
}

async function withQuestions(
  attemptId: string,
  payload: Omit<StartAttemptResult, "sections">,
  message: string,
): Promise<ActionResult<StartAttemptResult>> {
  const sections = await getPublishedQuizQuestionsForAttempt(attemptId);

  if (!sections || sections.length === 0) {
    return actionFailure("This quiz set has no questions yet.");
  }

  return actionSuccess(
    {
      ...payload,
      sections,
    },
    message,
  );
}

async function loadMaxScore(quizSetId: string) {
  const sectionMarks = await db
    .select({
      fullMarks: quizSections.fullMarks,
    })
    .from(quizSections)
    .where(eq(quizSections.quizSetId, quizSetId));

  return sectionMarks.reduce((sum, section) => sum + section.fullMarks, 0);
}

export async function startAttempt(
  input: StartAttemptInput,
): Promise<ActionResult<StartAttemptResult>> {
  const parsed = startAttemptSchema.safeParse(input);

  if (!parsed.success) {
    return actionFailure(
      "Please enter a valid access code.",
      zodErrorMap(parsed.error),
    );
  }

  const { quizSetId, code, participantName } = parsed.data;
  const now = new Date();

  const quizSet = await db.query.quizSets.findFirst({
    where: and(eq(quizSets.id, quizSetId), eq(quizSets.isPublished, true)),
    columns: {
      id: true,
      durationMinutes: true,
      isFreeMock: true,
    },
  });

  if (!quizSet) {
    return actionFailure("This quiz set is not available.");
  }

  const accessCode = await db.query.accessCodes.findFirst({
    where: and(
      eq(accessCodes.code, code),
      eq(accessCodes.quizSetId, quizSetId),
    ),
    columns: {
      id: true,
      isUsed: true,
      isShared: true,
      isRevoked: true,
      expiresAt: true,
    },
  });

  if (!accessCode) {
    return actionFailure("Invalid access code for this quiz set.", {
      code: "Invalid access code for this quiz set.",
    });
  }

  if (accessCode.isRevoked) {
    return actionFailure("This access code has been revoked.", {
      code: "This access code has been revoked.",
    });
  }

  if (quizSet.isFreeMock && !accessCode.isShared) {
    return actionFailure(
      "Use the shared free-mock code for this quiz (not a one-time code).",
      {
        code: "Use the shared free-mock code for this quiz (not a one-time code).",
      },
    );
  }

  const isShared = accessCode.isShared;

  if (isShared) {
    if (!accessCode.expiresAt) {
      return actionFailure("This shared code is missing an expiry date.", {
        code: "This shared code is missing an expiry date.",
      });
    }

    if (accessCode.expiresAt.getTime() < now.getTime()) {
      return actionFailure("This access code has expired.", {
        code: "This access code has expired.",
      });
    }

    const resumeAttemptId = parsed.data.resumeAttemptId?.trim();

    if (resumeAttemptId) {
      const existingAttempt = await db.query.quizAttempts.findFirst({
        where: and(
          eq(quizAttempts.id, resumeAttemptId),
          eq(quizAttempts.accessCodeId, accessCode.id),
          eq(quizAttempts.quizSetId, quizSetId),
        ),
        columns: {
          id: true,
          status: true,
          startedAt: true,
          participantName: true,
        },
      });

      if (existingAttempt) {
        const timing = deadlinePayload(
          existingAttempt.startedAt,
          quizSet.durationMinutes,
        );

        if (existingAttempt.status === "cancelled") {
          return cancelledResult(existingAttempt.id);
        }

        if (existingAttempt.status === "completed") {
          return actionSuccess(
            {
              attemptId: existingAttempt.id,
              resumed: false,
              completed: true,
              ...timing,
            },
            "This attempt is already completed. View your results.",
          );
        }

        if (
          isPastDeadline(
            existingAttempt.startedAt,
            quizSet.durationMinutes,
            now,
          )
        ) {
          return actionSuccess(
            {
              attemptId: existingAttempt.id,
              resumed: true,
              deadlineExpired: true,
              ...timing,
            },
            "Time is up for this attempt. Submitting your answers.",
          );
        }

        return withQuestions(
          existingAttempt.id,
          {
            attemptId: existingAttempt.id,
            resumed: true,
            ...timing,
          },
          "Resuming your in-progress attempt. Untimed answers from before refresh are not restored; timed questions keep theirs.",
        );
      }
    }

    const rawName = participantName?.trim() ?? "";
    if (!rawName) {
      return actionFailure("Enter your name to start this free mock.", {
        participantName: "Enter your name to start this free mock.",
      });
    }

    const displayName = formatParticipantName(rawName);
    const nameKey = normalizeParticipantNameKey(displayName);

    if (!nameKey) {
      return actionFailure("Enter your name to start this free mock.", {
        participantName: "Enter your name to start this free mock.",
      });
    }

    const maxScore = await loadMaxScore(quizSetId);

    if (maxScore <= 0) {
      return actionFailure("This quiz set has no scorable sections yet.");
    }

    const attemptId = crypto.randomUUID();

    try {
      await db.insert(quizAttempts).values({
        id: attemptId,
        quizSetId,
        accessCodeId: accessCode.id,
        status: "in_progress",
        participantName: displayName,
        participantNameKey: nameKey,
        score: 0,
        maxScore,
        startedAt: now,
        completedAt: null,
      });

      const started = await withQuestions(
        attemptId,
        {
          attemptId,
          resumed: false,
          ...deadlinePayload(now, quizSet.durationMinutes),
        },
        "Code accepted. Good luck.",
      );

      if (!started.success) {
        await db
          .delete(quizAttempts)
          .where(eq(quizAttempts.id, attemptId));
      }

      return started;
    } catch (error) {
      await db.delete(quizAttempts).where(eq(quizAttempts.id, attemptId));
      console.error("Shared startAttempt insert failed:", error);
      return actionFailure("Could not start this attempt. Please try again.");
    }
  }

  // One-time codes
  if (
    accessCode.expiresAt &&
    accessCode.expiresAt.getTime() < now.getTime() &&
    !accessCode.isUsed
  ) {
    return actionFailure("This access code has expired.", {
      code: "This access code has expired.",
    });
  }

  const existingOneTime = await db.query.quizAttempts.findFirst({
    where: eq(quizAttempts.accessCodeId, accessCode.id),
    columns: {
      id: true,
      status: true,
      startedAt: true,
    },
  });

  if (existingOneTime) {
    const timing = deadlinePayload(
      existingOneTime.startedAt,
      quizSet.durationMinutes,
    );

    if (existingOneTime.status === "cancelled") {
      return cancelledResult(existingOneTime.id);
    }

    if (existingOneTime.status === "completed") {
      return actionSuccess(
        {
          attemptId: existingOneTime.id,
          resumed: false,
          completed: true,
          ...timing,
        },
        "This code was already used. View your results.",
      );
    }

    if (
      isPastDeadline(existingOneTime.startedAt, quizSet.durationMinutes, now)
    ) {
      return actionSuccess(
        {
          attemptId: existingOneTime.id,
          resumed: true,
          deadlineExpired: true,
          ...timing,
        },
        "Time is up for this attempt. Submitting your answers.",
      );
    }

    return withQuestions(
      existingOneTime.id,
      {
        attemptId: existingOneTime.id,
        resumed: true,
        ...timing,
      },
      "Resuming your in-progress attempt.",
    );
  }

  if (accessCode.isUsed) {
    return actionFailure("This access code has already been used.", {
      code: "This access code has already been used.",
    });
  }

  const maxScore = await loadMaxScore(quizSetId);

  if (maxScore <= 0) {
    return actionFailure("This quiz set has no scorable sections yet.");
  }

  const attemptId = crypto.randomUUID();

  try {
    await db.transaction(async (tx) => {
      const updated = await tx
        .update(accessCodes)
        .set({
          isUsed: true,
          usedAt: now,
        })
        .where(
          and(eq(accessCodes.id, accessCode.id), eq(accessCodes.isUsed, false)),
        )
        .returning({ id: accessCodes.id });

      if (updated.length === 0) {
        throw new Error("CODE_ALREADY_USED");
      }

      await tx.insert(quizAttempts).values({
        id: attemptId,
        quizSetId,
        accessCodeId: accessCode.id,
        status: "in_progress",
        participantName: null,
        participantNameKey: null,
        score: 0,
        maxScore,
        startedAt: now,
        completedAt: null,
      });
    });
  } catch (error) {
    if (
      (error instanceof Error && error.message === "CODE_ALREADY_USED") ||
      isUniqueViolation(error)
    ) {
      const existing = await db.query.quizAttempts.findFirst({
        where: eq(quizAttempts.accessCodeId, accessCode.id),
        columns: {
          id: true,
          status: true,
          startedAt: true,
        },
      });

      if (existing?.status === "cancelled") {
        return cancelledResult(existing.id);
      }

      if (existing?.status === "in_progress") {
        if (
          isPastDeadline(existing.startedAt, quizSet.durationMinutes, now)
        ) {
          return actionSuccess(
            {
              attemptId: existing.id,
              resumed: true,
              deadlineExpired: true,
              ...deadlinePayload(existing.startedAt, quizSet.durationMinutes),
            },
            "Time is up for this attempt. Submitting your answers.",
          );
        }

        return withQuestions(
          existing.id,
          {
            attemptId: existing.id,
            resumed: true,
            ...deadlinePayload(existing.startedAt, quizSet.durationMinutes),
          },
          "Resuming your in-progress attempt.",
        );
      }

      if (existing?.status === "completed") {
        return actionSuccess(
          {
            attemptId: existing.id,
            resumed: false,
            completed: true,
            ...deadlinePayload(existing.startedAt, quizSet.durationMinutes),
          },
          "This code was already used. View your results.",
        );
      }

      return actionFailure("This access code has already been used.", {
        code: "This access code has already been used.",
      });
    }

    throw error;
  }

  return withQuestions(
    attemptId,
    {
      attemptId,
      resumed: false,
      ...deadlinePayload(now, quizSet.durationMinutes),
    },
    "Code accepted. Good luck.",
  );
}
