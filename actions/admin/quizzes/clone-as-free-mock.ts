"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import {
  actionFailure,
  actionSuccess,
  isForeignKeyViolation,
  isUniqueViolation,
  zodErrorMap,
  type ActionResult,
} from "@/lib/action-result";
import { getCurrentAdmin } from "@/lib/auth/get-current-admin";
import { db } from "@/db";
import { options, questions, quizSections, quizSets } from "@/db/schema";
import {
  cloneQuizSetAsFreeMockSchema,
  type CloneQuizSetAsFreeMockInput,
} from "@/modules/admin/schemas/quiz-set";

export async function cloneQuizSetAsFreeMock(
  input: CloneQuizSetAsFreeMockInput,
): Promise<ActionResult<{ id: string }>> {
  const admin = await getCurrentAdmin();

  if (!admin.success) {
    return actionFailure(admin.message);
  }

  const parsed = cloneQuizSetAsFreeMockSchema.safeParse(input);

  if (!parsed.success) {
    return actionFailure(
      "Please fix the highlighted fields.",
      zodErrorMap(parsed.error),
    );
  }

  const { sourceId, title, slug } = parsed.data;

  const source = await db.query.quizSets.findFirst({
    where: eq(quizSets.id, sourceId),
    columns: {
      id: true,
      facultyId: true,
      description: true,
      durationMinutes: true,
      isFreeMock: true,
    },
    with: {
      faculty: {
        columns: {
          slug: true,
        },
      },
      sections: {
        orderBy: (table, { asc: orderAsc }) => [orderAsc(table.position)],
        columns: {
          id: true,
          subjectId: true,
          fullMarks: true,
          position: true,
        },
        with: {
          questions: {
            orderBy: (table, { asc: orderAsc }) => [orderAsc(table.position)],
            columns: {
              id: true,
              prompt: true,
              marks: true,
              timeLimitSeconds: true,
              position: true,
            },
            with: {
              options: {
                orderBy: (table, { asc: orderAsc }) => [
                  orderAsc(table.position),
                ],
                columns: {
                  label: true,
                  position: true,
                  isCorrect: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!source) {
    return actionFailure("Quiz set not found.");
  }

  if (source.isFreeMock) {
    return actionFailure(
      "This quiz set is already a free mock. Duplicate a regular quiz set instead.",
    );
  }

  if (source.sections.length === 0) {
    return actionFailure("This quiz set has no sections to copy.");
  }

  for (const section of source.sections) {
    if (section.questions.length === 0) {
      return actionFailure(
        "Every section needs at least one question before duplicating.",
      );
    }

    for (const question of section.questions) {
      if (question.options.length === 0) {
        return actionFailure(
          "Every question needs options before duplicating. Fix the source quiz set first.",
        );
      }

      if (question.options.length !== 4) {
        return actionFailure(
          "Every question must have exactly 4 options before duplicating.",
        );
      }

      const correctCount = question.options.filter(
        (option) => option.isCorrect,
      ).length;
      if (correctCount !== 1) {
        return actionFailure(
          "Every question must have exactly one correct option before duplicating.",
        );
      }
    }
  }

  const quizSetId = crypto.randomUUID();

  try {
    await db.transaction(async (tx) => {
      await tx.insert(quizSets).values({
        id: quizSetId,
        facultyId: source.facultyId,
        title,
        slug,
        description: source.description,
        durationMinutes: source.durationMinutes,
        isPublished: false,
        isFreeMock: true,
        createdById: admin.adminId,
      });

      for (const section of source.sections) {
        const sectionId = crypto.randomUUID();

        await tx.insert(quizSections).values({
          id: sectionId,
          quizSetId,
          subjectId: section.subjectId,
          fullMarks: section.fullMarks,
          position: section.position,
        });

        for (const question of section.questions) {
          const questionId = crypto.randomUUID();

          await tx.insert(questions).values({
            id: questionId,
            quizSectionId: sectionId,
            prompt: question.prompt,
            marks: question.marks,
            timeLimitSeconds: question.timeLimitSeconds,
            position: question.position,
          });

          await tx.insert(options).values(
            question.options.map((option) => ({
              id: crypto.randomUUID(),
              questionId,
              label: option.label,
              position: option.position as 1 | 2 | 3 | 4,
              isCorrect: option.isCorrect,
            })),
          );
        }
      }
    });
  } catch (error) {
    console.error("cloneQuizSetAsFreeMock failed:", error);

    if (isUniqueViolation(error)) {
      return actionFailure(
        "A quiz set with this slug already exists for the faculty.",
        { slug: "Slug must be unique within the faculty." },
      );
    }

    if (isForeignKeyViolation(error)) {
      return actionFailure(
        "Could not duplicate this quiz set because a linked subject is missing. Refresh and try again.",
      );
    }

    return actionFailure(
      "Could not duplicate this quiz set. Please try again.",
    );
  }

  revalidatePath("/admin/quizzes");
  revalidatePath("/admin/codes");
  revalidatePath("/admin");
  revalidatePath(`/faculty/${source.faculty.slug}`);
  revalidatePath("/mocks");

  return actionSuccess(
    { id: quizSetId },
    "Free mock duplicate created. Publish it and generate a shared code when ready.",
  );
}
