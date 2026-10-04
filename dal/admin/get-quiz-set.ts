import { asc, count, eq } from "drizzle-orm";

import { db } from "@/db";
import { quizAttempts, quizSets, subjects } from "@/db/schema";
import { requireAdminForDal } from "@/dal/admin/require-admin";

export type AdminQuizOption = {
  id: string;
  label: string;
  position: number;
  isCorrect: boolean;
};

export type AdminQuizQuestion = {
  id: string;
  prompt: string;
  marks: number;
  timeLimitSeconds: number | null;
  position: number;
  options: AdminQuizOption[];
};

export type AdminQuizSection = {
  id: string;
  subjectId: string;
  subjectName: string;
  fullMarks: number;
  position: number;
  questions: AdminQuizQuestion[];
};

export type AdminQuizSetDetail = {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  durationMinutes: number;
  isPublished: boolean;
  isFreeMock: boolean;
  facultyId: string;
  facultyName: string;
  facultySlug: string;
  hasAttempts: boolean;
  sections: AdminQuizSection[];
};

export type SubjectOption = {
  id: string;
  name: string;
  facultyId: string;
};

export async function getQuizSetById(
  id: string,
): Promise<AdminQuizSetDetail | null> {
  await requireAdminForDal();

  const quizSet = await db.query.quizSets.findFirst({
    where: eq(quizSets.id, id),
    with: {
      faculty: {
        columns: {
          id: true,
          name: true,
          slug: true,
        },
      },
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

  if (!quizSet) {
    return null;
  }

  const attemptCount = await db
    .select({ value: count() })
    .from(quizAttempts)
    .where(eq(quizAttempts.quizSetId, id));

  return {
    id: quizSet.id,
    title: quizSet.title,
    slug: quizSet.slug,
    description: quizSet.description,
    durationMinutes: quizSet.durationMinutes,
    isPublished: quizSet.isPublished,
    isFreeMock: quizSet.isFreeMock,
    facultyId: quizSet.faculty.id,
    facultyName: quizSet.faculty.name,
    facultySlug: quizSet.faculty.slug,
    hasAttempts: Number(attemptCount[0]?.value ?? 0) > 0,
    sections: quizSet.sections.map((section) => ({
      id: section.id,
      subjectId: section.subject.id,
      subjectName: section.subject.name,
      fullMarks: section.fullMarks,
      position: section.position,
      questions: section.questions.map((question) => ({
        id: question.id,
        prompt: question.prompt,
        marks: question.marks,
        timeLimitSeconds: question.timeLimitSeconds,
        position: question.position,
        options: question.options.map((option) => ({
          id: option.id,
          label: option.label,
          position: option.position,
          isCorrect: option.isCorrect,
        })),
      })),
    })),
  };
}

export async function getSubjectOptions(
  facultyId?: string,
): Promise<SubjectOption[]> {
  await requireAdminForDal();

  return db
    .select({
      id: subjects.id,
      name: subjects.name,
      facultyId: subjects.facultyId,
    })
    .from(subjects)
    .where(facultyId ? eq(subjects.facultyId, facultyId) : undefined)
    .orderBy(asc(subjects.name));
}

export async function quizSetHasAttempts(quizSetId: string) {
  await requireAdminForDal();

  const attemptCount = await db
    .select({ value: count() })
    .from(quizAttempts)
    .where(eq(quizAttempts.quizSetId, quizSetId));

  return Number(attemptCount[0]?.value ?? 0) > 0;
}
