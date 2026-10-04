"use server";

import { and, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import {
  actionFailure,
  actionSuccess,
  isUniqueViolation,
  zodErrorMap,
  type ActionResult,
} from "@/lib/action-result";
import { validateDuration } from "@/lib/question-timer";
import { getCurrentAdmin } from "@/lib/auth/get-current-admin";
import { db } from "@/db";
import {
  faculties,
  options,
  questions,
  quizSections,
  quizSets,
  subjects,
} from "@/db/schema";
import {
  createQuizSetSchema,
  type CreateQuizSetInput,
} from "@/modules/admin/schemas/quiz-set";

export async function createQuizSet(
  input: CreateQuizSetInput,
): Promise<ActionResult<{ id: string }>> {
  const admin = await getCurrentAdmin();

  if (!admin.success) {
    return actionFailure(admin.message);
  }

  const parsed = createQuizSetSchema.safeParse(input);

  if (!parsed.success) {
    return actionFailure(
      "Please fix the highlighted fields.",
      zodErrorMap(parsed.error),
    );
  }

  const data = parsed.data;

  const duration = validateDuration(
    data.sections.flatMap((section) =>
      section.questions.map((question) => question.timeLimitSeconds),
    ),
    data.durationMinutes,
  );

  if (!duration.ok) {
    return actionFailure(duration.message, {
      durationMinutes: duration.message,
    });
  }

  const faculty = await db.query.faculties.findFirst({
    where: eq(faculties.id, data.facultyId),
    columns: { id: true, slug: true },
  });

  if (!faculty) {
    return actionFailure("Selected faculty does not exist.", {
      facultyId: "Select a valid faculty.",
    });
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

  const quizSetId = crypto.randomUUID();

  try {
    await db.transaction(async (tx) => {
      await tx.insert(quizSets).values({
        id: quizSetId,
        facultyId: data.facultyId,
        title: data.title,
        slug: data.slug,
        description: data.description || null,
        durationMinutes: duration.minutes,
        isPublished: data.isPublished,
        isFreeMock: data.isFreeMock,
        createdById: admin.adminId,
      });

      for (const [sectionIndex, section] of data.sections.entries()) {
        const sectionId = crypto.randomUUID();

        await tx.insert(quizSections).values({
          id: sectionId,
          quizSetId,
          subjectId: section.subjectId,
          fullMarks: section.fullMarks,
          position: sectionIndex + 1,
        });

        for (const [questionIndex, question] of section.questions.entries()) {
          const questionId = crypto.randomUUID();

          await tx.insert(questions).values({
            id: questionId,
            quizSectionId: sectionId,
            prompt: question.prompt,
            marks: question.marks,
            timeLimitSeconds: question.timeLimitSeconds,
            position: questionIndex + 1,
          });

          await tx.insert(options).values(
            question.options.map((option, optionIndex) => ({
              id: crypto.randomUUID(),
              questionId,
              label: option.label,
              position: (optionIndex + 1) as 1 | 2 | 3 | 4,
              isCorrect: option.isCorrect,
            })),
          );
        }
      }
    });
  } catch (error) {
    console.error("createQuizSet failed:", error);

    if (isUniqueViolation(error)) {
      return actionFailure(
        "A quiz set with this slug already exists for the faculty.",
        { slug: "Slug must be unique within the faculty." },
      );
    }

    return actionFailure("Could not create quiz set. Please try again.");
  }

  revalidatePath("/admin/quizzes");
  revalidatePath("/admin/codes");
  revalidatePath("/admin");
  revalidatePath(`/faculty/${faculty.slug}`);

  return actionSuccess({ id: quizSetId }, "Quiz set created.");
}
