import { z } from "zod";

import { slugify } from "@/lib/slugify";

const optionSchema = z.object({
  id: z.string().optional(),
  label: z.string().trim().min(1, "Option label is required."),
  isCorrect: z.boolean(),
});

const questionSchema = z.object({
  id: z.string().optional(),
  prompt: z.string().trim().min(1, "Question prompt is required."),
  /** Points for a correct answer. Hidden in UI for now; defaults to 1. */
  marks: z.coerce
    .number()
    .int("Question marks must be a whole number.")
    .positive("Question marks must be greater than 0.")
    .default(1),
  options: z
    .array(optionSchema)
    .length(4, "Each question must have exactly 4 options.")
    .refine((options) => options.filter((option) => option.isCorrect).length === 1, {
      message: "Mark exactly one correct option.",
    }),
});

const sectionSchema = z
  .object({
    id: z.string().optional(),
    subjectId: z.string().min(1, "Select a subject."),
    fullMarks: z.coerce
      .number()
      .int("Full marks must be a whole number.")
      .positive("Full marks must be greater than 0."),
    questions: z
      .array(questionSchema)
      .min(1, "Each section needs at least one question."),
  })
  .superRefine((section, ctx) => {
    const questionMarksTotal = section.questions.reduce(
      (sum, question) => sum + question.marks,
      0,
    );

    if (section.fullMarks !== questionMarksTotal) {
      ctx.addIssue({
        code: "custom",
        message: `Full marks must equal the sum of question marks (${questionMarksTotal}).`,
        path: ["fullMarks"],
      });
    }
  });

export const quizSetMetaSchema = z.object({
  title: z
    .string()
    .trim()
    .min(2, "Title must be at least 2 characters.")
    .max(160, "Title must be at most 160 characters."),
  slug: z
    .string()
    .trim()
    .min(2, "Slug must be at least 2 characters.")
    .max(160, "Slug must be at most 160 characters.")
    .regex(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      "Slug may only contain lowercase letters, numbers, and hyphens.",
    )
    .transform((value) => slugify(value)),
  description: z
    .string()
    .trim()
    .max(1000, "Description must be at most 1000 characters.")
    .optional()
    .or(z.literal("")),
  durationMinutes: z.coerce
    .number()
    .int("Duration must be a whole number.")
    .positive("Duration must be greater than 0.")
    .max(600, "Duration must be at most 600 minutes."),
  facultyId: z.string().min(1, "Select a faculty."),
  isPublished: z.boolean().default(false),
  isFreeMock: z.boolean().default(false),
});

export const createQuizSetSchema = quizSetMetaSchema.extend({
  sections: z
    .array(sectionSchema)
    .min(1, "Add at least one subject section.")
    .superRefine((sections, ctx) => {
      const seen = new Set<string>();

      for (const [index, section] of sections.entries()) {
        if (seen.has(section.subjectId)) {
          ctx.addIssue({
            code: "custom",
            message: "Each subject can only appear once in a quiz set.",
            path: [index, "subjectId"],
          });
        }

        seen.add(section.subjectId);
      }
    }),
});

export const updateQuizSetSchema = createQuizSetSchema.extend({
  id: z.string().min(1, "Quiz set id is required."),
});

export const updateQuizSetMetaSchema = quizSetMetaSchema
  .omit({ facultyId: true })
  .extend({
    id: z.string().min(1, "Quiz set id is required."),
  });

export const deleteQuizSetSchema = z.object({
  id: z.string().min(1, "Quiz set id is required."),
});

export const setQuizSetPublishedSchema = z.object({
  id: z.string().min(1, "Quiz set id is required."),
  isPublished: z.boolean(),
});

export const setQuizSetFreeMockSchema = z.object({
  id: z.string().min(1, "Quiz set id is required."),
  isFreeMock: z.boolean(),
});

export const cloneQuizSetAsFreeMockSchema = z.object({
  sourceId: z.string().min(1, "Quiz set id is required."),
  title: quizSetMetaSchema.shape.title,
  slug: quizSetMetaSchema.shape.slug,
});

export type CreateQuizSetInput = z.infer<typeof createQuizSetSchema>;
export type UpdateQuizSetInput = z.infer<typeof updateQuizSetSchema>;
export type UpdateQuizSetMetaInput = z.infer<typeof updateQuizSetMetaSchema>;
export type DeleteQuizSetInput = z.infer<typeof deleteQuizSetSchema>;
export type SetQuizSetPublishedInput = z.infer<typeof setQuizSetPublishedSchema>;
export type SetQuizSetFreeMockInput = z.infer<typeof setQuizSetFreeMockSchema>;
export type CloneQuizSetAsFreeMockInput = z.infer<
  typeof cloneQuizSetAsFreeMockSchema
>;
