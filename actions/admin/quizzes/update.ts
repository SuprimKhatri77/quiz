"use server";

import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import {
  actionFailure,
  actionSuccess,
  isUniqueViolation,
  zodErrorMap,
  type ActionResult,
} from "@/lib/action-result";
import { getCurrentAdmin } from "@/lib/auth/get-current-admin";
import { db } from "@/db";
import {
  accessCodes,
  options,
  questions,
  quizSections,
  quizSets,
  subjects,
} from "@/db/schema";
import { quizSetHasAttempts } from "@/dal/admin/get-quiz-set";
import {
  setQuizSetFreeMockSchema,
  setQuizSetPublishedSchema,
  updateQuizSetMetaSchema,
  updateQuizSetSchema,
  type SetQuizSetFreeMockInput,
  type SetQuizSetPublishedInput,
  type UpdateQuizSetInput,
  type UpdateQuizSetMetaInput,
} from "@/modules/admin/schemas/quiz-set";

const POSITION_PARK = 1_000_000;

async function assertCanDisableFreeMock(
  quizSetId: string,
  nextIsFreeMock: boolean,
  currentlyIsFreeMock: boolean,
): Promise<Extract<ActionResult, { success: false }> | null> {
  if (nextIsFreeMock || !currentlyIsFreeMock) {
    return null;
  }

  const activeShared = await db.query.accessCodes.findFirst({
    where: and(
      eq(accessCodes.quizSetId, quizSetId),
      eq(accessCodes.isShared, true),
      eq(accessCodes.isRevoked, false),
    ),
    columns: { id: true, code: true },
  });

  if (!activeShared) {
    return null;
  }

  return actionFailure(
    `Revoke the active shared code (${activeShared.code}) before turning off free mock.`,
    {
      isFreeMock:
        "Revoke the active shared code on the Codes page before disabling free mock.",
    },
  );
}

export type UpdatedQuizSetSection = {
  id: string;
  subjectId: string;
  subjectName: string;
  questions: Array<{
    id: string;
    prompt: string;
    marks: number;
    options: Array<{
      id: string;
      label: string;
      isCorrect: boolean;
    }>;
  }>;
};

export type UpdatedQuizSetResult = {
  id: string;
  sections: UpdatedQuizSetSection[];
};

type IncomingQuestion = UpdateQuizSetInput["sections"][number]["questions"][number];

type ExistingQuestion = {
  id: string;
  prompt: string;
  marks: number;
  position: number;
  options: Array<{ label: string; isCorrect: boolean; position: number }>;
};

type ExistingSection = {
  id: string;
  subjectId: string;
  fullMarks: number;
  position: number;
  questions: ExistingQuestion[];
};

async function revalidateQuizPaths(quizSetId: string, facultySlug?: string) {
  revalidatePath("/admin/quizzes");
  revalidatePath(`/admin/quizzes/${quizSetId}`);
  revalidatePath("/admin/codes");
  revalidatePath("/admin");

  if (facultySlug) {
    revalidatePath(`/faculty/${facultySlug}`);
  }
}

async function loadUpdatedQuizSetResult(
  quizSetId: string,
): Promise<UpdatedQuizSetResult | null> {
  const saved = await db.query.quizSets.findFirst({
    where: eq(quizSets.id, quizSetId),
    with: {
      sections: {
        orderBy: (table, { asc: orderAsc }) => [orderAsc(table.position)],
        with: {
          subject: {
            columns: {
              id: true,
              name: true,
            },
          },
          questions: {
            orderBy: (table, { asc: orderAsc }) => [orderAsc(table.position)],
            with: {
              options: {
                orderBy: (table, { asc: orderAsc }) => [
                  orderAsc(table.position),
                ],
              },
            },
          },
        },
      },
    },
  });

  if (!saved) {
    return null;
  }

  return {
    id: saved.id,
    sections: saved.sections.map((section) => ({
      id: section.id,
      subjectId: section.subject.id,
      subjectName: section.subject.name,
      questions: section.questions.map((question) => ({
        id: question.id,
        prompt: question.prompt,
        marks: question.marks,
        options: question.options.map((option) => ({
          id: option.id,
          label: option.label,
          isCorrect: option.isCorrect,
        })),
      })),
    })),
  };
}

function optionsMatch(
  existing: Array<{ label: string; isCorrect: boolean; position: number }>,
  next: Array<{ label: string; isCorrect: boolean }>,
) {
  if (existing.length !== next.length) return false;

  const sorted = [...existing].sort((a, b) => a.position - b.position);

  return next.every((option, index) => {
    const current = sorted[index];
    return (
      Boolean(current) &&
      current.label === option.label &&
      current.isCorrect === option.isCorrect
    );
  });
}

function questionsUnchanged(
  existing: ExistingQuestion[],
  next: IncomingQuestion[],
) {
  if (existing.length !== next.length) return false;

  const sortedExisting = [...existing].sort(
    (a, b) => a.position - b.position,
  );

  return next.every((question, index) => {
    const current = sortedExisting[index];
    return (
      Boolean(current) &&
      Boolean(question.id) &&
      current.id === question.id &&
      current.prompt === question.prompt &&
      current.marks === question.marks &&
      current.position === index + 1 &&
      optionsMatch(current.options, question.options)
    );
  });
}

export async function updateQuizSetMeta(
  input: UpdateQuizSetMetaInput,
): Promise<ActionResult<{ id: string }>> {
  const admin = await getCurrentAdmin();

  if (!admin.success) {
    return actionFailure(admin.message);
  }

  const parsed = updateQuizSetMetaSchema.safeParse(input);

  if (!parsed.success) {
    return actionFailure(
      "Please fix the highlighted fields.",
      zodErrorMap(parsed.error),
    );
  }

  const existing = await db.query.quizSets.findFirst({
    where: eq(quizSets.id, parsed.data.id),
    with: {
      faculty: {
        columns: { slug: true },
      },
    },
  });

  if (!existing) {
    return actionFailure("Quiz set not found.");
  }

  const freeMockGuard = await assertCanDisableFreeMock(
    parsed.data.id,
    parsed.data.isFreeMock,
    existing.isFreeMock,
  );
  if (freeMockGuard) {
    return freeMockGuard;
  }

  try {
    await db
      .update(quizSets)
      .set({
        title: parsed.data.title,
        slug: parsed.data.slug,
        description: parsed.data.description || null,
        durationMinutes: parsed.data.durationMinutes,
        isPublished: parsed.data.isPublished,
        isFreeMock: parsed.data.isFreeMock,
      })
      .where(eq(quizSets.id, parsed.data.id));
  } catch (error) {
    console.error("updateQuizSetMeta failed:", error);

    if (isUniqueViolation(error)) {
      return actionFailure(
        "A quiz set with this slug already exists for the faculty.",
        { slug: "Slug must be unique within the faculty." },
      );
    }

    return actionFailure("Could not update quiz set. Please try again.");
  }

  await revalidateQuizPaths(parsed.data.id, existing.faculty.slug);
  return actionSuccess({ id: parsed.data.id }, "Quiz set updated.");
}

export async function setQuizSetPublished(
  input: SetQuizSetPublishedInput,
): Promise<ActionResult<{ id: string; isPublished: boolean }>> {
  const admin = await getCurrentAdmin();

  if (!admin.success) {
    return actionFailure(admin.message);
  }

  const parsed = setQuizSetPublishedSchema.safeParse(input);

  if (!parsed.success) {
    return actionFailure("Invalid publish state.", zodErrorMap(parsed.error));
  }

  const existing = await db.query.quizSets.findFirst({
    where: eq(quizSets.id, parsed.data.id),
    with: {
      faculty: {
        columns: { slug: true },
      },
    },
  });

  if (!existing) {
    return actionFailure("Quiz set not found.");
  }

  try {
    await db
      .update(quizSets)
      .set({ isPublished: parsed.data.isPublished })
      .where(eq(quizSets.id, parsed.data.id));
  } catch (error) {
    console.error("setQuizSetPublished failed:", error);
    return actionFailure("Could not update publish state. Please try again.");
  }

  await revalidateQuizPaths(parsed.data.id, existing.faculty.slug);

  return actionSuccess(
    { id: parsed.data.id, isPublished: parsed.data.isPublished },
    parsed.data.isPublished ? "Quiz set published." : "Quiz set unpublished.",
  );
}

export async function setQuizSetFreeMock(
  input: SetQuizSetFreeMockInput,
): Promise<ActionResult<{ id: string; isFreeMock: boolean }>> {
  const admin = await getCurrentAdmin();

  if (!admin.success) {
    return actionFailure(admin.message);
  }

  const parsed = setQuizSetFreeMockSchema.safeParse(input);

  if (!parsed.success) {
    return actionFailure("Invalid free mock state.", zodErrorMap(parsed.error));
  }

  const existing = await db.query.quizSets.findFirst({
    where: eq(quizSets.id, parsed.data.id),
    with: {
      faculty: {
        columns: { slug: true },
      },
    },
  });

  if (!existing) {
    return actionFailure("Quiz set not found.");
  }

  if (existing.isFreeMock === parsed.data.isFreeMock) {
    return actionSuccess(
      { id: existing.id, isFreeMock: existing.isFreeMock },
      "Free mock state unchanged.",
    );
  }

  const freeMockGuard = await assertCanDisableFreeMock(
    parsed.data.id,
    parsed.data.isFreeMock,
    existing.isFreeMock,
  );
  if (freeMockGuard) {
    return freeMockGuard;
  }

  try {
    await db
      .update(quizSets)
      .set({ isFreeMock: parsed.data.isFreeMock })
      .where(eq(quizSets.id, parsed.data.id));
  } catch (error) {
    console.error("setQuizSetFreeMock failed:", error);
    return actionFailure("Could not update free mock state. Please try again.");
  }

  await revalidateQuizPaths(parsed.data.id, existing.faculty.slug);
  revalidatePath("/mocks");

  return actionSuccess(
    { id: parsed.data.id, isFreeMock: parsed.data.isFreeMock },
    parsed.data.isFreeMock
      ? "Marked as free mock. Generate a shared code on the Codes page."
      : "Free mock disabled.",
  );
}

export async function updateQuizSet(
  input: UpdateQuizSetInput,
): Promise<ActionResult<UpdatedQuizSetResult>> {
  const admin = await getCurrentAdmin();

  if (!admin.success) {
    return actionFailure(admin.message);
  }

  const parsed = updateQuizSetSchema.safeParse(input);

  if (!parsed.success) {
    return actionFailure(
      "Please fix the highlighted fields.",
      zodErrorMap(parsed.error),
    );
  }

  const data = parsed.data;

  const existing = await db.query.quizSets.findFirst({
    where: eq(quizSets.id, data.id),
    with: {
      faculty: {
        columns: { id: true, slug: true },
      },
    },
  });

  if (!existing) {
    return actionFailure("Quiz set not found.");
  }

  if (data.facultyId !== existing.facultyId) {
    return actionFailure("Faculty cannot be changed after creation.", {
      facultyId: "Faculty is locked for this quiz set.",
    });
  }

  const freeMockGuard = await assertCanDisableFreeMock(
    data.id,
    data.isFreeMock,
    existing.isFreeMock,
  );
  if (freeMockGuard) {
    return freeMockGuard;
  }

  const hasAttempts = await quizSetHasAttempts(data.id);

  if (hasAttempts) {
    const metaResult = await updateQuizSetMeta({
      id: data.id,
      title: data.title,
      slug: data.slug,
      description: data.description,
      durationMinutes: data.durationMinutes,
      isPublished: data.isPublished,
      isFreeMock: data.isFreeMock,
    });

    if (!metaResult.success) {
      return metaResult;
    }

    const saved = await loadUpdatedQuizSetResult(data.id);

    if (!saved) {
      return actionFailure("Quiz set was saved but could not be reloaded.");
    }

    return actionSuccess(saved, metaResult.message ?? "Quiz set updated.");
  }

  const subjectIds = data.sections.map((section) => section.subjectId);
  const facultySubjects = await db
    .select({ id: subjects.id })
    .from(subjects)
    .where(
      and(
        eq(subjects.facultyId, data.facultyId),
        inArray(subjects.id, subjectIds),
      ),
    );

  if (facultySubjects.length !== new Set(subjectIds).size) {
    return actionFailure(
      "Every section subject must belong to the selected faculty.",
      { sections: "Invalid subject selection." },
    );
  }

  try {
    await db.transaction(async (tx) => {
      await tx
        .update(quizSets)
        .set({
          title: data.title,
          slug: data.slug,
          description: data.description || null,
          durationMinutes: data.durationMinutes,
          isPublished: data.isPublished,
          isFreeMock: data.isFreeMock,
        })
        .where(eq(quizSets.id, data.id));

      const keptSectionIds = data.sections
        .map((section) => section.id)
        .filter((id): id is string => Boolean(id));

      if (keptSectionIds.length > 0) {
        await tx
          .delete(quizSections)
          .where(
            and(
              eq(quizSections.quizSetId, data.id),
              notInArray(quizSections.id, keptSectionIds),
            ),
          );
      } else {
        await tx
          .delete(quizSections)
          .where(eq(quizSections.quizSetId, data.id));
      }

      const existingSections = (await tx.query.quizSections.findMany({
        where: eq(quizSections.quizSetId, data.id),
        with: {
          questions: {
            orderBy: (table, { asc: orderAsc }) => [orderAsc(table.position)],
            with: {
              options: {
                orderBy: (table, { asc: orderAsc }) => [
                  orderAsc(table.position),
                ],
              },
            },
          },
        },
      })) as ExistingSection[];

      const sectionById = new Map(
        existingSections.map((section) => [section.id, section]),
      );

      if (existingSections.length > 0) {
        await tx
          .update(quizSections)
          .set({ position: sql`${quizSections.position} + ${POSITION_PARK}` })
          .where(eq(quizSections.quizSetId, data.id));
      }

      const sectionsNeedingQuestionPark: string[] = [];

      for (const section of data.sections) {
        if (!section.id) continue;
        const existingSection = sectionById.get(section.id);
        if (!existingSection) continue;
        if (!questionsUnchanged(existingSection.questions, section.questions)) {
          sectionsNeedingQuestionPark.push(section.id);
        }
      }

      if (sectionsNeedingQuestionPark.length > 0) {
        await tx
          .update(questions)
          .set({ position: sql`${questions.position} + ${POSITION_PARK}` })
          .where(inArray(questions.quizSectionId, sectionsNeedingQuestionPark));
      }

      const questionsToInsert: Array<{
        id: string;
        quizSectionId: string;
        prompt: string;
        marks: number;
        position: number;
      }> = [];
      const optionsToInsert: Array<{
        id: string;
        questionId: string;
        label: string;
        position: 1 | 2 | 3 | 4;
        isCorrect: boolean;
      }> = [];
      const questionUpdates: Array<() => Promise<unknown>> = [];
      const optionRewriteDeletes: Array<() => Promise<unknown>> = [];

      for (const [sectionIndex, section] of data.sections.entries()) {
        const sectionId = section.id ?? crypto.randomUUID();
        const existingSection = section.id
          ? sectionById.get(section.id)
          : undefined;

        if (existingSection) {
          await tx
            .update(quizSections)
            .set({
              subjectId: section.subjectId,
              fullMarks: section.fullMarks,
              position: sectionIndex + 1,
            })
            .where(
              and(
                eq(quizSections.id, sectionId),
                eq(quizSections.quizSetId, data.id),
              ),
            );
        } else {
          await tx.insert(quizSections).values({
            id: sectionId,
            quizSetId: data.id,
            subjectId: section.subjectId,
            fullMarks: section.fullMarks,
            position: sectionIndex + 1,
          });
        }

        if (
          existingSection &&
          questionsUnchanged(existingSection.questions, section.questions)
        ) {
          continue;
        }

        const existingQuestions = existingSection?.questions ?? [];
        const existingQuestionById = new Map(
          existingQuestions.map((question) => [question.id, question]),
        );

        const keptQuestionIds = section.questions
          .map((question) => question.id)
          .filter((id): id is string => Boolean(id));

        if (keptQuestionIds.length > 0) {
          await tx
            .delete(questions)
            .where(
              and(
                eq(questions.quizSectionId, sectionId),
                notInArray(questions.id, keptQuestionIds),
              ),
            );
        } else if (existingQuestions.length > 0) {
          await tx
            .delete(questions)
            .where(eq(questions.quizSectionId, sectionId));
        }

        for (const [questionIndex, question] of section.questions.entries()) {
          const position = questionIndex + 1;
          const questionId = question.id;

          if (!questionId) {
            const newQuestionId = crypto.randomUUID();
            questionsToInsert.push({
              id: newQuestionId,
              quizSectionId: sectionId,
              prompt: question.prompt,
              marks: question.marks,
              position,
            });

            for (const [optionIndex, option] of question.options.entries()) {
              optionsToInsert.push({
                id: crypto.randomUUID(),
                questionId: newQuestionId,
                label: option.label,
                position: (optionIndex + 1) as 1 | 2 | 3 | 4,
                isCorrect: option.isCorrect,
              });
            }
            continue;
          }

          const existingQuestion = existingQuestionById.get(questionId);
          if (!existingQuestion) {
            throw new Error("INVALID_QUESTION_SECTION");
          }

          questionUpdates.push(() =>
            tx
              .update(questions)
              .set({
                prompt: question.prompt,
                marks: question.marks,
                position,
              })
              .where(
                and(
                  eq(questions.id, questionId),
                  eq(questions.quizSectionId, sectionId),
                ),
              ),
          );

          const shouldRewriteOptions = !optionsMatch(
            existingQuestion.options,
            question.options,
          );

          if (shouldRewriteOptions) {
            optionRewriteDeletes.push(() =>
              tx.delete(options).where(eq(options.questionId, questionId)),
            );

            for (const [optionIndex, option] of question.options.entries()) {
              optionsToInsert.push({
                id: crypto.randomUUID(),
                questionId,
                label: option.label,
                position: (optionIndex + 1) as 1 | 2 | 3 | 4,
                isCorrect: option.isCorrect,
              });
            }
          }
        }
      }

      const chunkSize = 40;

      for (let i = 0; i < optionRewriteDeletes.length; i += chunkSize) {
        await Promise.all(
          optionRewriteDeletes.slice(i, i + chunkSize).map((run) => run()),
        );
      }

      for (let i = 0; i < questionUpdates.length; i += chunkSize) {
        await Promise.all(
          questionUpdates.slice(i, i + chunkSize).map((run) => run()),
        );
      }

      if (questionsToInsert.length > 0) {
        const insertChunk = 100;
        for (let i = 0; i < questionsToInsert.length; i += insertChunk) {
          await tx
            .insert(questions)
            .values(questionsToInsert.slice(i, i + insertChunk));
        }
      }

      if (optionsToInsert.length > 0) {
        const insertChunk = 200;
        for (let i = 0; i < optionsToInsert.length; i += insertChunk) {
          await tx
            .insert(options)
            .values(optionsToInsert.slice(i, i + insertChunk));
        }
      }
    });
  } catch (error) {
    console.error("updateQuizSet failed:", error);

    if (error instanceof Error && error.message === "INVALID_QUESTION_SECTION") {
      return actionFailure(
        "One or more questions do not belong to this quiz section.",
        { sections: "Invalid question selection." },
      );
    }

    if (isUniqueViolation(error)) {
      return actionFailure(
        "Could not save quiz structure due to a uniqueness conflict.",
      );
    }

    return actionFailure("Could not update quiz set. Please try again.");
  }

  const saved = await loadUpdatedQuizSetResult(data.id);

  if (!saved) {
    return actionFailure("Quiz set was saved but could not be reloaded.");
  }

  await revalidateQuizPaths(data.id, existing.faculty.slug);
  return actionSuccess(saved, "Quiz set updated.");
}
