import { z } from "zod";

export const startAttemptSchema = z.object({
  quizSetId: z.string().min(1, "Quiz set is required."),
  code: z
    .string()
    .trim()
    .min(4, "Access code looks too short.")
    .transform((value) => value.toUpperCase()),
  participantName: z
    .string()
    .trim()
    .max(80, "Name must be at most 80 characters.")
    .optional()
    .or(z.literal("")),
  /** Browser cookie resume for free mocks (in-progress attempt). */
  resumeAttemptId: z.string().min(1).optional(),
});

export type StartAttemptInput = z.infer<typeof startAttemptSchema>;

export const submitAttemptSchema = z.object({
  attemptId: z.string().min(1, "Attempt is required."),
  answers: z.record(z.string().min(1), z.string().min(1)).default({}),
  /** Client auto-submit when the timer hits zero. */
  timedOut: z.boolean().optional(),
});

export type SubmitAttemptInput = z.infer<typeof submitAttemptSchema>;

export const startQuestionSchema = z.object({
  attemptId: z.string().min(1, "Attempt is required."),
  questionId: z.string().min(1, "Question is required."),
});

export type StartQuestionInput = z.infer<typeof startQuestionSchema>;

export const saveAnswerSchema = z.object({
  attemptId: z.string().min(1, "Attempt is required."),
  questionId: z.string().min(1, "Question is required."),
  optionId: z.string().min(1, "Option is required."),
});

export type SaveAnswerInput = z.infer<typeof saveAnswerSchema>;

export const resolveAccessCodeSchema = z.object({
  code: z
    .string()
    .trim()
    .min(4, "Access code looks too short.")
    .transform((value) => value.toUpperCase()),
});

export type ResolveAccessCodeInput = z.infer<typeof resolveAccessCodeSchema>;

export const unlockAnswerSheetSchema = z.object({
  facultySlug: z.string().min(1),
  quizSetSlug: z.string().min(1),
  code: z
    .string()
    .trim()
    .min(4, "Access code looks too short.")
    .transform((value) => value.toUpperCase()),
  attemptId: z.string().min(1).optional(),
});

export type UnlockAnswerSheetInput = z.infer<typeof unlockAnswerSheetSchema>;

export const reportLeaveSchema = z.object({
  attemptId: z.string().min(1, "Attempt is required."),
  reason: z.enum(["hidden", "blur", "fullscreen_exit", "unload"]),
  /** Client-measured time away in ms; null for unload. */
  durationMs: z.number().int().min(0).max(24 * 60 * 60 * 1000).nullable(),
});

export type ReportLeaveInput = z.infer<typeof reportLeaveSchema>;
