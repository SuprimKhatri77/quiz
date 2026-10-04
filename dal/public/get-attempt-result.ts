import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import {
  accessCodes,
  attemptAnswers,
  faculties,
  quizAttempts,
  quizSections,
  quizSets,
} from "@/db/schema";

export type AttemptSectionResult = {
  sectionId: string;
  subjectName: string;
  score: number;
  fullMarks: number;
};

export type AttemptResultSummary = {
  attemptId: string;
  quizSetId: string;
  quizSetTitle: string;
  quizSetSlug: string;
  facultyName: string;
  facultySlug: string;
  isFreeMock: boolean;
  score: number;
  maxScore: number;
  percentage: number;
  completedAt: Date;
  sections: AttemptSectionResult[];
};

export type AnswerSheetOption = {
  id: string;
  label: string;
  position: number;
  isCorrect: boolean;
  isSelected: boolean;
};

export type AnswerSheetQuestion = {
  id: string;
  prompt: string;
  position: number;
  selectedOptionId: string;
  isCorrect: boolean;
  options: AnswerSheetOption[];
};

export type AnswerSheetSection = {
  sectionId: string;
  subjectName: string;
  score: number;
  fullMarks: number;
  questions: AnswerSheetQuestion[];
};

export type AttemptAnswerSheet = AttemptResultSummary & {
  sections: AnswerSheetSection[];
};

function buildSectionScores(
  sections: {
    id: string;
    fullMarks: number;
    subject: { name: string };
    questions: { id: string; marks: number }[];
  }[],
  correctByQuestion: Map<string, boolean>,
): AttemptSectionResult[] {
  return sections.map((section) => {
    let score = 0;

    for (const question of section.questions) {
      if (correctByQuestion.get(question.id)) {
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
}

async function getQuizSetContext(facultySlug: string, quizSetSlug: string) {
  const faculty = await db.query.faculties.findFirst({
    where: eq(faculties.slug, facultySlug),
    columns: {
      id: true,
      name: true,
      slug: true,
    },
  });

  if (!faculty) {
    return null;
  }

  const quizSet = await db.query.quizSets.findFirst({
    where: and(
      eq(quizSets.facultyId, faculty.id),
      eq(quizSets.slug, quizSetSlug),
      eq(quizSets.isPublished, true),
    ),
    columns: {
      id: true,
      title: true,
      slug: true,
      isFreeMock: true,
    },
  });

  if (!quizSet) {
    return null;
  }

  return {
    ...quizSet,
    faculty: {
      name: faculty.name,
      slug: faculty.slug,
    },
  };
}

async function loadAttemptAnswers(attemptId: string) {
  return db
    .select({
      questionId: attemptAnswers.questionId,
      optionId: attemptAnswers.optionId,
      isCorrect: attemptAnswers.isCorrect,
    })
    .from(attemptAnswers)
    .where(eq(attemptAnswers.attemptId, attemptId));
}

async function loadSectionsForScoring(quizSetId: string) {
  return db.query.quizSections.findMany({
    where: eq(quizSections.quizSetId, quizSetId),
    orderBy: (table, { asc: orderAsc }) => [orderAsc(table.position)],
    columns: {
      id: true,
      fullMarks: true,
    },
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
        },
      },
    },
  });
}

async function loadSectionsWithOptions(quizSetId: string) {
  return db.query.quizSections.findMany({
    where: eq(quizSections.quizSetId, quizSetId),
    orderBy: (table, { asc: orderAsc }) => [orderAsc(table.position)],
    columns: {
      id: true,
      fullMarks: true,
    },
    with: {
      subject: {
        columns: {
          name: true,
        },
      },
      questions: {
        orderBy: (table, { asc: orderAsc }) => [orderAsc(table.position)],
        columns: {
          id: true,
          prompt: true,
          position: true,
          marks: true,
        },
        with: {
          options: {
            orderBy: (table, { asc: orderAsc }) => [orderAsc(table.position)],
            columns: {
              id: true,
              label: true,
              position: true,
              isCorrect: true,
            },
          },
        },
      },
    },
  });
}

function toSummary(
  quizSet: NonNullable<Awaited<ReturnType<typeof getQuizSetContext>>>,
  attempt: {
    id: string;
    score: number;
    maxScore: number;
    completedAt: Date;
  },
  sectionScores: AttemptSectionResult[],
): AttemptResultSummary {
  return {
    attemptId: attempt.id,
    quizSetId: quizSet.id,
    quizSetTitle: quizSet.title,
    quizSetSlug: quizSet.slug,
    facultyName: quizSet.faculty.name,
    facultySlug: quizSet.faculty.slug,
    isFreeMock: quizSet.isFreeMock,
    score: attempt.score,
    maxScore: attempt.maxScore,
    percentage: Math.round((attempt.score / attempt.maxScore) * 100),
    completedAt: attempt.completedAt,
    sections: sectionScores,
  };
}

/** Score summary only — safe to show with attempt id (no answer key). */
export async function getAttemptResultSummary({
  facultySlug,
  quizSetSlug,
  attemptId,
}: {
  facultySlug: string;
  quizSetSlug: string;
  attemptId: string;
}): Promise<AttemptResultSummary | null> {
  const quizSet = await getQuizSetContext(facultySlug, quizSetSlug);

  if (!quizSet) {
    return null;
  }

  const attempt = await db.query.quizAttempts.findFirst({
    where: and(
      eq(quizAttempts.id, attemptId),
      eq(quizAttempts.quizSetId, quizSet.id),
      eq(quizAttempts.status, "completed"),
    ),
    columns: {
      id: true,
      score: true,
      maxScore: true,
      completedAt: true,
    },
  });

  if (!attempt?.completedAt) {
    return null;
  }

  const [sections, answers] = await Promise.all([
    loadSectionsForScoring(quizSet.id),
    loadAttemptAnswers(attempt.id),
  ]);

  const correctByQuestion = new Map(
    answers.map((answer) => [answer.questionId, answer.isCorrect]),
  );

  return toSummary(
    quizSet,
    { ...attempt, completedAt: attempt.completedAt },
    buildSectionScores(sections, correctByQuestion),
  );
}

async function buildAnswerSheet(
  quizSet: NonNullable<Awaited<ReturnType<typeof getQuizSetContext>>>,
  attempt: {
    id: string;
    score: number;
    maxScore: number;
    completedAt: Date;
  },
): Promise<AttemptAnswerSheet> {
  const [sections, answers] = await Promise.all([
    loadSectionsWithOptions(quizSet.id),
    loadAttemptAnswers(attempt.id),
  ]);

  const answerByQuestion = new Map(
    answers.map((answer) => [answer.questionId, answer]),
  );

  const sheetSections: AnswerSheetSection[] = sections.map((section) => {
    let score = 0;

    const questions: AnswerSheetQuestion[] = section.questions.map(
      (question) => {
        const answer = answerByQuestion.get(question.id);
        const selectedOptionId = answer?.optionId ?? "";
        const isCorrect = Boolean(answer?.isCorrect);

        if (isCorrect) {
          score += question.marks;
        }

        return {
          id: question.id,
          prompt: question.prompt,
          position: question.position,
          selectedOptionId,
          isCorrect,
          options: question.options.map((option) => ({
            id: option.id,
            label: option.label,
            position: option.position,
            isCorrect: option.isCorrect,
            isSelected: option.id === selectedOptionId,
          })),
        };
      },
    );

    return {
      sectionId: section.id,
      subjectName: section.subject.name,
      score,
      fullMarks: section.fullMarks,
      questions,
    };
  });

  return {
    ...toSummary(
      quizSet,
      attempt,
      sheetSections.map((section) => ({
        sectionId: section.sectionId,
        subjectName: section.subjectName,
        score: section.score,
        fullMarks: section.fullMarks,
      })),
    ),
    sections: sheetSections,
  };
}

/**
 * Full answer sheet — only after proving the access code for this attempt.
 * Reveals correct options. Shared codes require attemptId (many runs per code).
 */
export async function getAttemptAnswerSheetByCode({
  facultySlug,
  quizSetSlug,
  code,
  attemptId,
}: {
  facultySlug: string;
  quizSetSlug: string;
  code: string;
  attemptId?: string;
}): Promise<AttemptAnswerSheet | null> {
  const quizSet = await getQuizSetContext(facultySlug, quizSetSlug);

  if (!quizSet) {
    return null;
  }

  const normalized = code.trim().toUpperCase();

  if (!normalized) {
    return null;
  }

  const accessCode = await db.query.accessCodes.findFirst({
    where: and(
      eq(accessCodes.code, normalized),
      eq(accessCodes.quizSetId, quizSet.id),
    ),
    columns: {
      id: true,
      isRevoked: true,
      isShared: true,
    },
  });

  if (!accessCode || accessCode.isRevoked) {
    return null;
  }

  let attempt: {
    id: string;
    score: number;
    maxScore: number;
    completedAt: Date | null;
    status: "in_progress" | "completed" | "cancelled";
  } | null = null;

  if (attemptId) {
    attempt =
      (await db.query.quizAttempts.findFirst({
        where: and(
          eq(quizAttempts.id, attemptId),
          eq(quizAttempts.accessCodeId, accessCode.id),
        ),
        columns: {
          id: true,
          score: true,
          maxScore: true,
          completedAt: true,
          status: true,
        },
      })) ?? null;
  } else if (accessCode.isShared) {
    // Ambiguous without attemptId when many runs share one code.
    return null;
  } else {
    attempt =
      (await db.query.quizAttempts.findFirst({
        where: eq(quizAttempts.accessCodeId, accessCode.id),
        columns: {
          id: true,
          score: true,
          maxScore: true,
          completedAt: true,
          status: true,
        },
      })) ?? null;
  }

  if (!attempt || attempt.status !== "completed" || !attempt.completedAt) {
    return null;
  }

  return buildAnswerSheet(quizSet, {
    id: attempt.id,
    score: attempt.score,
    maxScore: attempt.maxScore,
    completedAt: attempt.completedAt,
  });
}

/** @deprecated Use getAttemptAnswerSheetByCode */
export async function getAttemptResult({
  facultySlug,
  quizSetSlug,
  code,
}: {
  facultySlug: string;
  quizSetSlug: string;
  code: string;
}): Promise<AttemptAnswerSheet | null> {
  return getAttemptAnswerSheetByCode({
    facultySlug,
    quizSetSlug,
    code,
  });
}

export type AttemptResult = AttemptResultSummary;
