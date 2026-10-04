import { relations, sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/* ───────────────────────────── Auth (Better Auth) ───────────────────────────── */
export const user = pgTable(
  "user",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    emailVerified: boolean("email_verified").default(false).notNull(),
    image: text("image"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    role: text("role").default("user").notNull(),
    banned: boolean("banned").default(false),
    banReason: text("ban_reason"),
    banExpires: timestamp("ban_expires"),
  },
  (table) => [
    check(
      "user_role_allowed",
      sql`${table.role} IN ('admin', 'superadmin', 'user')`,
    ),
  ],
);

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    impersonatedBy: text("impersonated_by"),
  },
  (table) => [index("session_userId_idx").on(table.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("account_userId_idx").on(table.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

/* ───────────────────────────── Quiz domain ───────────────────────────── */

export const quizAttemptStatusEnum = pgEnum("quiz_attempt_status", [
  "in_progress",
  "completed",
  "cancelled",
]);

/**
 * Faculty catalog (e.g. Science and Technology).
 * A faculty can own many quiz sets and many subjects.
 */
export const faculties = pgTable(
  "faculties",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    /** URL slug for /faculty/[slug] */
    slug: text("slug").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("faculties_name_uid").on(table.name),
    uniqueIndex("faculties_slug_uid").on(table.slug),
  ],
);

/**
 * Subject catalog under a faculty (English, Maths, Science, GK).
 * Reused across quiz sets for that faculty.
 */
export const subjects = pgTable(
  "subjects",
  {
    id: text("id").primaryKey(),
    facultyId: text("faculty_id")
      .notNull()
      .references(() => faculties.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    unique("subjects_faculty_id_name_uid").on(table.facultyId, table.name),
    index("subjects_faculty_id_idx").on(table.facultyId),
  ],
);

/**
 * Quiz set belonging to a faculty.
 * Listed on /faculty/[slug]. Example: "Entrance Assessment 2026".
 * Public URL: /faculty/[faculty-slug]/[quiz-set-slug]
 * A faculty can have many sets (midterm, final, another intake, etc.).
 */
export const quizSets = pgTable(
  "quiz_sets",
  {
    id: text("id").primaryKey(),
    facultyId: text("faculty_id")
      .notNull()
      .references(() => faculties.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    /** URL slug for /faculty/[faculty-slug]/[quiz-set-slug] */
    slug: text("slug").notNull(),
    description: text("description"),
    durationMinutes: integer("duration_minutes").default(120).notNull(),
    isPublished: boolean("is_published").default(false).notNull(),
    /** Free mock: shared code, timer, public leaderboard. */
    isFreeMock: boolean("is_free_mock").default(false).notNull(),
    /** Exam lockdown: leaving the exam window counts as a strike and can cancel the attempt. */
    lockdownEnabled: boolean("lockdown_enabled").default(false).notNull(),
    /** Leaves tolerated before the attempt is cancelled (0 = cancel on the first leave). */
    allowedLeaves: integer("allowed_leaves").default(1).notNull(),
    createdById: text("created_by_id").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    unique("quiz_sets_faculty_id_slug_uid").on(table.facultyId, table.slug),
    index("quiz_sets_faculty_id_idx").on(table.facultyId),
    index("quiz_sets_is_published_idx").on(table.isPublished),
    index("quiz_sets_created_by_id_idx").on(table.createdById),
    check(
      "quiz_sets_duration_minutes_positive",
      sql`${table.durationMinutes} > 0`,
    ),
    check(
      "quiz_sets_lockdown_not_free_mock",
      sql`NOT (${table.lockdownEnabled} AND ${table.isFreeMock})`,
    ),
    check(
      "quiz_sets_allowed_leaves_range",
      sql`${table.allowedLeaves} >= 0 AND ${table.allowedLeaves} <= 10`,
    ),
  ],
);

/**
 * Subject section inside a quiz set.
 * Example within one set: English 50, Maths 40, Science 45, GK 30.
 * Taking the set page shows all sections on one page.
 */
export const quizSections = pgTable(
  "quiz_sections",
  {
    id: text("id").primaryKey(),
    quizSetId: text("quiz_set_id")
      .notNull()
      .references(() => quizSets.id, { onDelete: "cascade" }),
    subjectId: text("subject_id")
      .notNull()
      .references(() => subjects.id, { onDelete: "restrict" }),
    fullMarks: integer("full_marks").notNull(),
    /** Display order of this subject block within the set. */
    position: integer("position").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    unique("quiz_sections_set_subject_uid").on(table.quizSetId, table.subjectId),
    unique("quiz_sections_set_position_uid").on(table.quizSetId, table.position),
    index("quiz_sections_quiz_set_id_idx").on(table.quizSetId),
    index("quiz_sections_subject_id_idx").on(table.subjectId),
    check("quiz_sections_full_marks_positive", sql`${table.fullMarks} > 0`),
    check("quiz_sections_position_positive", sql`${table.position} > 0`),
  ],
);

export const questions = pgTable(
  "questions",
  {
    id: text("id").primaryKey(),
    quizSectionId: text("quiz_section_id")
      .notNull()
      .references(() => quizSections.id, { onDelete: "cascade" }),
    prompt: text("prompt").notNull(),
    /** Points awarded when answered correctly. Defaults to 1. */
    marks: integer("marks").default(1).notNull(),
    /** Per-question time limit in seconds once the student starts it. Null = untimed. */
    timeLimitSeconds: integer("time_limit_seconds"),
    /** Display order within the subject section (1-based). */
    position: integer("position").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    unique("questions_section_id_position_uid").on(
      table.quizSectionId,
      table.position,
    ),
    index("questions_quiz_section_id_idx").on(table.quizSectionId),
    check("questions_position_positive", sql`${table.position} > 0`),
    check("questions_marks_positive", sql`${table.marks} > 0`),
    check(
      "questions_time_limit_positive",
      sql`${table.timeLimitSeconds} IS NULL OR ${table.timeLimitSeconds} > 0`,
    ),
  ],
);

export const options = pgTable(
  "options",
  {
    id: text("id").primaryKey(),
    questionId: text("question_id")
      .notNull()
      .references(() => questions.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    /** Slot among the 4 choices (1–4). */
    position: smallint("position").notNull(),
    isCorrect: boolean("is_correct").default(false).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    unique("options_question_id_position_uid").on(
      table.questionId,
      table.position,
    ),
    index("options_question_id_idx").on(table.questionId),
    check(
      "options_position_range",
      sql`${table.position} >= 1 AND ${table.position} <= 4`,
    ),
    uniqueIndex("options_one_correct_per_question_uid")
      .on(table.questionId)
      .where(sql`${table.isCorrect} = true`),
  ],
);

/**
 * Admin-issued access codes for a quiz set.
 * One-time codes (isShared=false): single attempt, marked used on start.
 * Shared free-mock codes (isShared=true): many named attempts until expiresAt.
 */
export const accessCodes = pgTable(
  "access_codes",
  {
    id: text("id").primaryKey(),
    quizSetId: text("quiz_set_id")
      .notNull()
      .references(() => quizSets.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    /** Admin marked this code as handed out to a student (not yet used). */
    isIssued: boolean("is_issued").default(false).notNull(),
    issuedAt: timestamp("issued_at"),
    isUsed: boolean("is_used").default(false).notNull(),
    usedAt: timestamp("used_at"),
    expiresAt: timestamp("expires_at"),
    /** Soft-disable without deleting attempts. */
    isRevoked: boolean("is_revoked").default(false).notNull(),
    revokedAt: timestamp("revoked_at"),
    /** Shared free-mock code: many attempts until expiry. */
    isShared: boolean("is_shared").default(false).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("access_codes_code_uid").on(table.code),
    index("access_codes_quiz_set_id_idx").on(table.quizSetId),
    index("access_codes_quiz_set_id_unused_idx")
      .on(table.quizSetId)
      .where(sql`${table.isUsed} = false`),
    /** At most one active (non-revoked) shared code per quiz set. */
    uniqueIndex("access_codes_one_active_shared_per_quiz_uid")
      .on(table.quizSetId)
      .where(sql`${table.isShared} = true AND ${table.isRevoked} = false`),
    check(
      "access_codes_used_consistency",
      sql`(${table.isUsed} = false AND ${table.usedAt} IS NULL) OR (${table.isUsed} = true AND ${table.usedAt} IS NOT NULL)`,
    ),
    check(
      "access_codes_issued_consistency",
      sql`(${table.isIssued} = false AND ${table.issuedAt} IS NULL) OR (${table.isIssued} = true AND ${table.issuedAt} IS NOT NULL)`,
    ),
    check(
      "access_codes_revoked_consistency",
      sql`(${table.isRevoked} = false AND ${table.revokedAt} IS NULL) OR (${table.isRevoked} = true AND ${table.revokedAt} IS NOT NULL)`,
    ),
    check(
      "access_codes_shared_requires_expiry",
      sql`${table.isShared} = false OR ${table.expiresAt} IS NOT NULL`,
    ),
  ],
);

/** Participation session for a quiz set (one-time or named free-mock attempt). */
export const quizAttempts = pgTable(
  "quiz_attempts",
  {
    id: text("id").primaryKey(),
    quizSetId: text("quiz_set_id")
      .notNull()
      .references(() => quizSets.id, { onDelete: "cascade" }),
    accessCodeId: text("access_code_id")
      .notNull()
      .references(() => accessCodes.id, { onDelete: "restrict" }),
    status: quizAttemptStatusEnum("status").default("in_progress").notNull(),
    /** Display name for free-mock leaderboard (shared codes). */
    participantName: text("participant_name"),
    /** Normalized display name key (shared codes; same names allowed across attempts). */
    participantNameKey: text("participant_name_key"),
    /** Total marks scored across all subject sections. */
    score: integer("score").default(0).notNull(),
    /** Snapshot of total full marks (sum of sections) at submit time. */
    maxScore: integer("max_score").notNull(),
    startedAt: timestamp("started_at").defaultNow().notNull(),
    completedAt: timestamp("completed_at"),
    /** Set when lockdown cancelled the attempt (void, admin can reopen). */
    cancelledAt: timestamp("cancelled_at"),
    cancelReason: text("cancel_reason"),
  },
  (table) => [
    // One-time codes: at most one attempt per code (no participant name).
    uniqueIndex("quiz_attempts_one_time_access_code_uid")
      .on(table.accessCodeId)
      .where(sql`${table.participantNameKey} IS NULL`),
    // Shared / free-mock: many attempts per code (resume via browser cookie).
    index("quiz_attempts_access_code_id_idx").on(table.accessCodeId),
    index("quiz_attempts_quiz_set_id_idx").on(table.quizSetId),
    index("quiz_attempts_quiz_set_id_status_idx").on(
      table.quizSetId,
      table.status,
    ),
    check("quiz_attempts_score_non_negative", sql`${table.score} >= 0`),
    check("quiz_attempts_max_score_positive", sql`${table.maxScore} > 0`),
    check(
      "quiz_attempts_score_lte_max",
      sql`${table.score} <= ${table.maxScore}`,
    ),
    check(
      "quiz_attempts_completed_consistency",
      sql`(${table.status}::text = 'in_progress' AND ${table.completedAt} IS NULL AND ${table.cancelledAt} IS NULL) OR (${table.status}::text = 'completed' AND ${table.completedAt} IS NOT NULL AND ${table.cancelledAt} IS NULL) OR (${table.status}::text = 'cancelled' AND ${table.cancelledAt} IS NOT NULL AND ${table.completedAt} IS NULL)`,
    ),
    check(
      "quiz_attempts_participant_name_consistency",
      sql`(${table.participantName} IS NULL AND ${table.participantNameKey} IS NULL) OR (${table.participantName} IS NOT NULL AND ${table.participantNameKey} IS NOT NULL)`,
    ),
  ],
);

export const attemptAnswers = pgTable(
  "attempt_answers",
  {
    id: text("id").primaryKey(),
    attemptId: text("attempt_id")
      .notNull()
      .references(() => quizAttempts.id, { onDelete: "cascade" }),
    questionId: text("question_id")
      .notNull()
      .references(() => questions.id, { onDelete: "restrict" }),
    optionId: text("option_id")
      .notNull()
      .references(() => options.id, { onDelete: "restrict" }),
    isCorrect: boolean("is_correct").notNull(),
    answeredAt: timestamp("answered_at").defaultNow().notNull(),
  },
  (table) => [
    unique("attempt_answers_attempt_id_question_id_uid").on(
      table.attemptId,
      table.questionId,
    ),
    index("attempt_answers_attempt_id_idx").on(table.attemptId),
    index("attempt_answers_question_id_idx").on(table.questionId),
  ],
);

/**
 * Per-attempt state for timed questions. A row exists once the student starts
 * the question; `startedAt` is the server-side authority for its countdown and
 * `selectedOptionId` is the saved answer (only written while the timer runs).
 */
export const attemptQuestionStates = pgTable(
  "attempt_question_states",
  {
    id: text("id").primaryKey(),
    attemptId: text("attempt_id")
      .notNull()
      .references(() => quizAttempts.id, { onDelete: "cascade" }),
    questionId: text("question_id")
      .notNull()
      .references(() => questions.id, { onDelete: "restrict" }),
    startedAt: timestamp("started_at").defaultNow().notNull(),
    selectedOptionId: text("selected_option_id").references(() => options.id, {
      onDelete: "set null",
    }),
    answeredAt: timestamp("answered_at"),
  },
  (table) => [
    unique("attempt_question_states_attempt_id_question_id_uid").on(
      table.attemptId,
      table.questionId,
    ),
    index("attempt_question_states_attempt_id_idx").on(table.attemptId),
  ],
);

/**
 * Leave events reported while a lockdown attempt is in progress. Only events
 * with countsAsStrike (and not forgiven by an admin reset) count toward the
 * set's allowed leaves.
 */
export const attemptLeaveEvents = pgTable(
  "attempt_leave_events",
  {
    id: text("id").primaryKey(),
    attemptId: text("attempt_id")
      .notNull()
      .references(() => quizAttempts.id, { onDelete: "cascade" }),
    occurredAt: timestamp("occurred_at").defaultNow().notNull(),
    /** Client-measured time away; null for unload (page closed/navigated). */
    durationMs: integer("duration_ms"),
    reason: text("reason").notNull(),
    countsAsStrike: boolean("counts_as_strike").notNull(),
    forgivenAt: timestamp("forgiven_at"),
  },
  (table) => [
    index("attempt_leave_events_attempt_id_idx").on(table.attemptId),
    check(
      "attempt_leave_events_reason_valid",
      sql`${table.reason} IN ('hidden', 'blur', 'fullscreen_exit', 'unload')`,
    ),
  ],
);

/* ───────────────────────────── Relations ───────────────────────────── */

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
  quizSets: many(quizSets),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id],
  }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id],
  }),
}));

export const facultiesRelations = relations(faculties, ({ many }) => ({
  subjects: many(subjects),
  quizSets: many(quizSets),
}));

export const subjectsRelations = relations(subjects, ({ one, many }) => ({
  faculty: one(faculties, {
    fields: [subjects.facultyId],
    references: [faculties.id],
  }),
  sections: many(quizSections),
}));

export const quizSetsRelations = relations(quizSets, ({ one, many }) => ({
  faculty: one(faculties, {
    fields: [quizSets.facultyId],
    references: [faculties.id],
  }),
  createdBy: one(user, {
    fields: [quizSets.createdById],
    references: [user.id],
  }),
  sections: many(quizSections),
  accessCodes: many(accessCodes),
  attempts: many(quizAttempts),
}));

export const quizSectionsRelations = relations(
  quizSections,
  ({ one, many }) => ({
    quizSet: one(quizSets, {
      fields: [quizSections.quizSetId],
      references: [quizSets.id],
    }),
    subject: one(subjects, {
      fields: [quizSections.subjectId],
      references: [subjects.id],
    }),
    questions: many(questions),
  }),
);

export const questionsRelations = relations(questions, ({ one, many }) => ({
  section: one(quizSections, {
    fields: [questions.quizSectionId],
    references: [quizSections.id],
  }),
  options: many(options),
  attemptAnswers: many(attemptAnswers),
  attemptStates: many(attemptQuestionStates),
}));

export const optionsRelations = relations(options, ({ one, many }) => ({
  question: one(questions, {
    fields: [options.questionId],
    references: [questions.id],
  }),
  attemptAnswers: many(attemptAnswers),
}));

export const accessCodesRelations = relations(accessCodes, ({ one, many }) => ({
  quizSet: one(quizSets, {
    fields: [accessCodes.quizSetId],
    references: [quizSets.id],
  }),
  attempts: many(quizAttempts),
}));

export const quizAttemptsRelations = relations(
  quizAttempts,
  ({ one, many }) => ({
    quizSet: one(quizSets, {
      fields: [quizAttempts.quizSetId],
      references: [quizSets.id],
    }),
    accessCode: one(accessCodes, {
      fields: [quizAttempts.accessCodeId],
      references: [accessCodes.id],
    }),
    answers: many(attemptAnswers),
    questionStates: many(attemptQuestionStates),
    leaveEvents: many(attemptLeaveEvents),
  }),
);

export const attemptAnswersRelations = relations(attemptAnswers, ({ one }) => ({
  attempt: one(quizAttempts, {
    fields: [attemptAnswers.attemptId],
    references: [quizAttempts.id],
  }),
  question: one(questions, {
    fields: [attemptAnswers.questionId],
    references: [questions.id],
  }),
  option: one(options, {
    fields: [attemptAnswers.optionId],
    references: [options.id],
  }),
}));

export const attemptQuestionStatesRelations = relations(
  attemptQuestionStates,
  ({ one }) => ({
    attempt: one(quizAttempts, {
      fields: [attemptQuestionStates.attemptId],
      references: [quizAttempts.id],
    }),
    question: one(questions, {
      fields: [attemptQuestionStates.questionId],
      references: [questions.id],
    }),
    selectedOption: one(options, {
      fields: [attemptQuestionStates.selectedOptionId],
      references: [options.id],
    }),
  }),
);

export const attemptLeaveEventsRelations = relations(
  attemptLeaveEvents,
  ({ one }) => ({
    attempt: one(quizAttempts, {
      fields: [attemptLeaveEvents.attemptId],
      references: [quizAttempts.id],
    }),
  }),
);
