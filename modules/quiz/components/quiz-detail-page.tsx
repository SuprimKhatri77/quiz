"use client";

import { CheckCircle2, Clock3, Trophy } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { toast } from "sonner";

import { saveAnswer } from "@/actions/quiz/save-answer";
import { startAttempt } from "@/actions/quiz/start-attempt";
import { startQuestion } from "@/actions/quiz/start-question";
import { submitAttempt } from "@/actions/quiz/submit-attempt";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type {
  PublicQuizQuestion,
  PublicQuizSection,
  PublicQuizSetMeta,
} from "@/dal/public/get-quiz-set";
import { cn } from "@/lib/utils";
import {
  clearMockAttemptCookie,
  getMockAttemptCookie,
  setMockAttemptCookie,
} from "@/lib/mock-attempt-cookie";
import { PublicPageShell } from "@/modules/public/components/public-page-shell";
import { ContentLeakGuard } from "@/modules/quiz/components/content-leak-guard";
import {
  formatCountdown,
  getQuestionStatus,
  QuestionCard,
} from "@/modules/quiz/components/quiz-question-card";
import {
  startAttemptSchema,
  submitAttemptSchema,
} from "@/modules/quiz/schemas/attempt";

type Step = "code" | "taking";

const WARN_20_MS = 20 * 60_000;
const WARN_5_MS = 5 * 60_000;

function resultHref(
  quizSet: PublicQuizSetMeta,
  {
    code,
    attemptId,
  }: {
    code?: string;
    attemptId?: string;
  },
) {
  const params = new URLSearchParams();
  if (attemptId) {
    params.set("attemptId", attemptId);
  }
  if (code) {
    params.set("code", code);
  }
  return `/faculty/${quizSet.faculty.slug}/${quizSet.slug}/result?${params.toString()}`;
}

export function QuizDetailPage({
  quizSet,
  initialCode,
  initialName,
}: {
  quizSet: PublicQuizSetMeta;
  initialCode?: string;
  initialName?: string;
}) {
  const router = useRouter();
  const autoStartedRef = useRef(false);
  const warned20Ref = useRef(false);
  const warned5Ref = useRef(false);
  const autoSubmitRef = useRef(false);
  const autoSubmitAttemptsRef = useRef(0);
  const [step, setStep] = useState<Step>("code");
  const [accessCode, setAccessCode] = useState(initialCode?.toUpperCase() ?? "");
  const [participantName, setParticipantName] = useState(initialName ?? "");
  const [nameError, setNameError] = useState<string>();
  const [codeError, setCodeError] = useState<string>();
  const [isVerifying, setIsVerifying] = useState(
    Boolean(initialCode && (!quizSet.isFreeMock || initialName?.trim())),
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [attemptId, setAttemptId] = useState<string>();
  const [deadlineAt, setDeadlineAt] = useState<string>();
  const [remainingMs, setRemainingMs] = useState<number>();
  const [sections, setSections] = useState<PublicQuizSection[] | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [hasStoredAttempt, setHasStoredAttempt] = useState(false);
  const [startingQuestionIds, setStartingQuestionIds] = useState<Set<string>>(
    () => new Set(),
  );
  // Server time minus client time, so per-question countdowns ignore client clock skew.
  const clockOffsetRef = useRef(0);
  const [nowMs, setNowMs] = useState(() => Date.now());
  // Serializes saves per question so quick re-selections land in order.
  const saveChainRef = useRef<Map<string, Promise<unknown>>>(new Map());

  const totalMarks = quizSet.totalMarks;
  const totalQuestions = quizSet.questionCount;
  const answeredCount = Object.keys(answers).length;
  const hasTimedQuestions = Boolean(
    sections?.some((section) =>
      section.questions.some((question) => question.timeLimitSeconds !== null),
    ),
  );
  const expiredUnansweredCount = (sections ?? []).reduce(
    (sum, section) =>
      sum +
      section.questions.filter(
        (question) =>
          !answers[question.id] &&
          getQuestionStatus(question, nowMs).status === "expired",
      ).length,
    0,
  );
  const progress =
    totalQuestions === 0
      ? 0
      : Math.round((answeredCount / totalQuestions) * 100);

  const leaderboardHref = `/faculty/${quizSet.faculty.slug}/${quizSet.slug}/leaderboard`;

  useEffect(() => {
    if (!quizSet.isFreeMock) {
      return;
    }
    setHasStoredAttempt(Boolean(getMockAttemptCookie(quizSet.id)));
  }, [quizSet.id, quizSet.isFreeMock]);

  async function verifyAndStart(
    code: string,
    name: string,
    { silent = false, forceNew = false } = {},
  ) {
    const resumeAttemptId =
      !forceNew && quizSet.isFreeMock
        ? getMockAttemptCookie(quizSet.id)
        : undefined;

    const parsed = startAttemptSchema.safeParse({
      quizSetId: quizSet.id,
      code,
      participantName: name,
      resumeAttemptId: resumeAttemptId ?? undefined,
    });

    if (!parsed.success) {
      const fieldErrors = parsed.error.flatten().fieldErrors;
      setCodeError(fieldErrors.code?.[0] ?? parsed.error.issues[0]?.message);
      setNameError(fieldErrors.participantName?.[0]);
      setIsVerifying(false);
      return;
    }

    // New free-mock start needs a name; resume from cookie does not.
    if (
      quizSet.isFreeMock &&
      !resumeAttemptId &&
      !parsed.data.participantName?.trim()
    ) {
      setNameError("Enter your name to start this free mock.");
      setIsVerifying(false);
      return;
    }

    setCodeError(undefined);
    setNameError(undefined);
    setIsVerifying(true);

    try {
      const response = await startAttempt(parsed.data);

      if (!response.success) {
        if (resumeAttemptId) {
          clearMockAttemptCookie(quizSet.id);
          setHasStoredAttempt(false);
        }
        setCodeError(response.errors?.code ?? response.message);
        setNameError(response.errors?.participantName);
        if (!silent) {
          toast.error(response.message);
        }
        return;
      }

      const nameForResult =
        parsed.data.participantName?.trim() || participantName.trim();

      if (response.data.completed) {
        clearMockAttemptCookie(quizSet.id);
        setHasStoredAttempt(false);
        toast.success(response.message ?? "Viewing your results.");
        router.replace(
          resultHref(quizSet, {
            code: parsed.data.code,
            attemptId: response.data.attemptId,
          }),
        );
        return;
      }

      if (response.data.deadlineExpired) {
        setAccessCode(parsed.data.code);
        if (nameForResult) {
          setParticipantName(nameForResult);
        }
        if (quizSet.isFreeMock) {
          setMockAttemptCookie(quizSet.id, response.data.attemptId, {
            durationMinutes:
              response.data.durationMinutes ?? quizSet.durationMinutes,
            deadlineAt: response.data.deadlineAt,
          });
        }
        toast.message(
          response.message ?? "Time is up. Submitting your answers…",
        );
        await finalizeSubmit({
          attemptId: response.data.attemptId,
          code: parsed.data.code,
          timedOut: true,
          answers: {},
        });
        return;
      }

      if (!response.data.sections?.length) {
        setCodeError("This quiz set has no questions yet.");
        toast.error("This quiz set has no questions yet.");
        return;
      }

      setAttemptId(response.data.attemptId);
      setAccessCode(parsed.data.code);
      if (nameForResult) {
        setParticipantName(nameForResult);
      }
      setDeadlineAt(response.data.deadlineAt);
      if (response.data.serverNow) {
        clockOffsetRef.current =
          new Date(response.data.serverNow).getTime() - Date.now();
      }
      setNowMs(Date.now() + clockOffsetRef.current);
      setSections(response.data.sections);
      // Timed answers are saved server-side; restore them after a refresh.
      setAnswers(
        Object.fromEntries(
          response.data.sections.flatMap((section) =>
            section.questions.flatMap((question) =>
              question.selectedOptionId
                ? [[question.id, question.selectedOptionId]]
                : [],
            ),
          ),
        ),
      );
      setStep("taking");
      warned20Ref.current = false;
      warned5Ref.current = false;
      autoSubmitRef.current = false;
      autoSubmitAttemptsRef.current = 0;

      if (quizSet.isFreeMock) {
        setMockAttemptCookie(quizSet.id, response.data.attemptId, {
          durationMinutes:
            response.data.durationMinutes ?? quizSet.durationMinutes,
          deadlineAt: response.data.deadlineAt,
        });
        setHasStoredAttempt(true);
      }

      toast.success(
        response.message ??
          (response.data.resumed
            ? "Resuming your in-progress attempt."
            : "Code accepted. Good luck."),
      );

      router.replace(`/faculty/${quizSet.faculty.slug}/${quizSet.slug}`, {
        scroll: false,
      });
    } finally {
      setIsVerifying(false);
    }
  }

  useEffect(() => {
    if (autoStartedRef.current) {
      return;
    }

    if (quizSet.isFreeMock) {
      const cookieId = getMockAttemptCookie(quizSet.id);
      // Resume with code + cookie (name optional). First start still needs name.
      if (initialCode && (initialName?.trim() || cookieId)) {
        autoStartedRef.current = true;
        setIsVerifying(true);
        void verifyAndStart(initialCode, initialName ?? "", { silent: true });
      }
      return;
    }

    if (!initialCode) {
      return;
    }

    autoStartedRef.current = true;
    void verifyAndStart(initialCode, "", { silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCode, initialName, quizSet.isFreeMock]);

  async function finalizeSubmit({
    attemptId: submitAttemptId,
    code,
    timedOut,
    answers: submitAnswers,
  }: {
    attemptId: string;
    code: string;
    timedOut: boolean;
    answers: Record<string, string>;
  }) {
    const parsed = submitAttemptSchema.safeParse({
      attemptId: submitAttemptId,
      answers: submitAnswers,
      timedOut,
    });

    if (!parsed.success) {
      toast.error(
        parsed.error.issues[0]?.message ?? "Unable to submit this attempt.",
      );
      return;
    }

    setIsSubmitting(true);

    try {
      // Timed answers only count once the server has them: let in-flight saves land first.
      await Promise.allSettled([...saveChainRef.current.values()]);

      const response = await submitAttempt(parsed.data);

      if (!response.success) {
        toast.error(response.message, { id: "submit-error" });
        // Auto-submit at the deadline must not give up after one refusal
        // (the server may still be inside its grace window): let the ticker retry.
        if (timedOut && autoSubmitAttemptsRef.current < 8) {
          autoSubmitAttemptsRef.current += 1;
          autoSubmitRef.current = false;
        }
        return;
      }

      toast.success(
        timedOut
          ? "Time is up — your answers were submitted."
          : "Quiz submitted.",
      );
      clearMockAttemptCookie(quizSet.id);
      setHasStoredAttempt(false);
      router.push(
        resultHref(quizSet, {
          code: code.trim().toUpperCase() || undefined,
          attemptId: submitAttemptId,
        }),
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  const submitQuiz = useEffectEvent(async (timedOut: boolean) => {
    if (isSubmitting || !attemptId) {
      return;
    }

    const deadlinePassedLocally =
      deadlineAt !== undefined &&
      Date.now() + clockOffsetRef.current >= new Date(deadlineAt).getTime();

    if (!timedOut && !deadlinePassedLocally && !quizSet.isFreeMock) {
      // Timed questions are skippable; only untimed ones must be answered.
      const unanswered = (sections ?? []).reduce(
        (sum, section) =>
          sum +
          section.questions.filter(
            (question) =>
              question.timeLimitSeconds === null && !answers[question.id],
          ).length,
        0,
      );
      if (unanswered > 0) {
        toast.error(
          `Answer all questions before submitting (${unanswered} left).`,
        );
        return;
      }
    }

    await finalizeSubmit({
      attemptId,
      code: accessCode,
      timedOut,
      answers,
    });
  });

  useEffect(() => {
    if (step !== "taking" || !deadlineAt) {
      return;
    }

    const deadline = deadlineAt;
    // Don't fire warnings for thresholds already passed (short/resumed attempts).
    const initialRemaining =
      new Date(deadline).getTime() - (Date.now() + clockOffsetRef.current);
    if (initialRemaining <= WARN_20_MS) {
      warned20Ref.current = true;
    }
    if (initialRemaining <= WARN_5_MS) {
      warned5Ref.current = true;
    }

    function tick() {
      setNowMs(Date.now() + clockOffsetRef.current);
      const remaining =
        new Date(deadline).getTime() - (Date.now() + clockOffsetRef.current);
      const clamped = Math.max(0, remaining);

      setRemainingMs((previous) => {
        // Avoid re-renders when the displayed second has not changed.
        if (
          previous !== undefined &&
          Math.ceil(previous / 1000) === Math.ceil(clamped / 1000)
        ) {
          return previous;
        }
        return clamped;
      });

      if (remaining <= WARN_20_MS && remaining > WARN_5_MS && !warned20Ref.current) {
        warned20Ref.current = true;
        toast.warning("20 minutes left on this mock.");
      }

      if (remaining <= WARN_5_MS && remaining > 0 && !warned5Ref.current) {
        warned5Ref.current = true;
        toast.warning("5 minutes left — wrap up soon.");
      }

      if (remaining <= 0 && !autoSubmitRef.current) {
        autoSubmitRef.current = true;
        void submitQuiz(true);
      }
    }

    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
    // submitQuiz is an Effect Event — omit from deps (not reactive).
  }, [step, deadlineAt]);

  async function handleVerifyCode(event: FormEvent) {
    event.preventDefault();
    await verifyAndStart(accessCode, participantName);
  }

  function selectOption(question: PublicQuizQuestion, optionId: string) {
    if (isSubmitting || !attemptId) return;

    if (question.timeLimitSeconds === null) {
      setAnswers((current) => ({ ...current, [question.id]: optionId }));
      return;
    }

    if (getQuestionStatus(question, Date.now() + clockOffsetRef.current).status !== "running") {
      return;
    }

    const previous = answers[question.id];
    setAnswers((current) => ({ ...current, [question.id]: optionId }));

    const chain = saveChainRef.current;
    const run = async () => {
      const rollback = () =>
        setAnswers((current) => {
          const copy = { ...current };
          if (previous) {
            copy[question.id] = previous;
          } else {
            delete copy[question.id];
          }
          return copy;
        });

      let response;
      try {
        response = await saveAnswer({
          attemptId,
          questionId: question.id,
          optionId,
        });
      } catch {
        rollback();
        toast.error("Could not save your answer. Check your connection.");
        return;
      }

      if (response.success) {
        return;
      }

      // Rejected (timer ran out, attempt over): roll back to what the server has.
      rollback();

      if (response.errors?.reason === "attempt_over") {
        toast.error(response.message);
        if (!autoSubmitRef.current) {
          autoSubmitRef.current = true;
          void submitQuiz(true);
        }
        return;
      }

      toast.error(response.message);
    };
    // run never rejects, so one failed save can't block later ones.
    const prior = chain.get(question.id) ?? Promise.resolve();
    chain.set(question.id, prior.then(run));
  }

  async function handleStartQuestion(questionId: string) {
    if (!attemptId || isSubmitting || startingQuestionIds.has(questionId)) {
      return;
    }

    setStartingQuestionIds((current) => new Set(current).add(questionId));

    try {
      const response = await startQuestion({ attemptId, questionId });

      if (!response.success) {
        toast.error(response.message);
        if (response.errors?.reason === "attempt_over" && !autoSubmitRef.current) {
          autoSubmitRef.current = true;
          void submitQuiz(true);
        }
        return;
      }

      clockOffsetRef.current =
        new Date(response.data.serverNow).getTime() - Date.now();
      setNowMs(Date.now() + clockOffsetRef.current);
      setSections((current) =>
        current
          ? current.map((section) => ({
              ...section,
              questions: section.questions.map((question) =>
                question.id === questionId
                  ? {
                      ...question,
                      content: response.data.content,
                      startedAt: response.data.startedAt,
                    }
                  : question,
              ),
            }))
          : current,
      );
    } finally {
      setStartingQuestionIds((current) => {
        const copy = new Set(current);
        copy.delete(questionId);
        return copy;
      });
    }
  }

  return (
    <PublicPageShell
      backHref={`/faculty/${quizSet.faculty.slug}`}
      backLabel={`Back to ${quizSet.faculty.name}`}
    >
      <div className="mb-10 space-y-5 border-b pb-8">
        <p className="text-xs font-medium tracking-[0.18em] text-muted-foreground uppercase">
          {quizSet.faculty.name}
          {quizSet.isFreeMock ? " · Free mock" : ""}
        </p>

        <div className="space-y-3">
          <h1 className="font-display text-4xl tracking-tight md:text-5xl">
            {quizSet.title}
          </h1>
          {quizSet.description ? (
            <p className="max-w-2xl text-base leading-7 text-muted-foreground">
              {quizSet.description}
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
          <MetaChip
            icon={<Trophy className="size-4" />}
            label={`${totalMarks} total marks`}
          />
          <MetaChip
            icon={<Clock3 className="size-4" />}
            label={`${quizSet.durationMinutes} min`}
          />
          <MetaChip
            icon={<CheckCircle2 className="size-4" />}
            label={`${totalQuestions} questions`}
          />
        </div>

        <div className="flex flex-wrap gap-2">
          {quizSet.sections.map((section) => (
            <span
              key={section.id}
              className="border bg-muted/50 px-3 py-1.5 text-xs font-medium"
            >
              {section.subject.name} · {section.fullMarks} marks
            </span>
          ))}
        </div>

        {quizSet.isFreeMock ? (
          <p className="flex flex-wrap gap-4 text-sm text-muted-foreground">
            <Link href={leaderboardHref} className="underline underline-offset-4">
              View leaderboard
            </Link>
            <Link href="/mocks" className="underline underline-offset-4">
              All free mocks
            </Link>
          </p>
        ) : null}
      </div>

      {step === "code" && (
        <section className="w-full max-w-lg border bg-card p-6 md:p-8">
          <div className="mb-6 space-y-2">
            <p className="text-xs font-medium tracking-[0.18em] text-muted-foreground uppercase">
              Access required
            </p>
            <h2 className="font-display text-3xl tracking-tight">
              {isVerifying && initialCode
                ? "Starting your quiz…"
                : quizSet.isFreeMock
                  ? "Enter free mock details"
                  : "Enter your one-time code"}
            </h2>
            <p className="text-sm leading-6 text-muted-foreground">
              {isVerifying && initialCode
                ? "Validating your access code and opening the quiz set."
                : quizSet.isFreeMock
                  ? "Use the shared mock code and your name. The timer starts when you begin. Refreshing mid-mock keeps the timer; untimed answers are not restored, timed-question answers are."
                  : "One code unlocks the full faculty set — all subject sections on this page."}
            </p>
          </div>

          {quizSet.isFreeMock && hasStoredAttempt && !isVerifying ? (
            <div className="mb-5 space-y-2 border bg-muted/40 px-4 py-3 text-sm">
              <p>
                This browser has an in-progress attempt. Enter the shared code
                to continue the timer (answers from before refresh are not
                restored).
              </p>
              <button
                type="button"
                className="underline underline-offset-4"
                onClick={() => {
                  clearMockAttemptCookie(quizSet.id);
                  setHasStoredAttempt(false);
                  toast.message("Cleared saved attempt. Start fresh with your name.");
                }}
              >
                Start a new attempt instead
              </button>
            </div>
          ) : null}

          {isVerifying && initialCode ? (
            <div className="space-y-3">
              <div className="h-11 w-full animate-pulse bg-muted" />
              <div className="h-10 w-40 animate-pulse bg-muted" />
            </div>
          ) : (
            <form className="space-y-5" onSubmit={handleVerifyCode}>
              {quizSet.isFreeMock ? (
                <Field>
                  <FieldLabel htmlFor="participant-name">Your name</FieldLabel>
                  <Input
                    id="participant-name"
                    value={participantName}
                    onChange={(event) => {
                      setNameError(undefined);
                      setParticipantName(event.target.value);
                    }}
                    placeholder="As it should appear on the leaderboard"
                    className="h-11"
                    aria-invalid={Boolean(nameError)}
                    autoComplete="name"
                    disabled={isVerifying}
                  />
                  <FieldError>{nameError}</FieldError>
                </Field>
              ) : null}

              <Field>
                <FieldLabel htmlFor="access-code">Access code</FieldLabel>
                <Input
                  id="access-code"
                  value={accessCode}
                  onChange={(event) => {
                    setCodeError(undefined);
                    setAccessCode(event.target.value.toUpperCase());
                  }}
                  placeholder="Example: FST-2026-88"
                  className="h-11 tracking-wide"
                  aria-invalid={Boolean(codeError)}
                  autoComplete="off"
                  disabled={isVerifying}
                />
                <FieldError>{codeError}</FieldError>
              </Field>

              <Button type="submit" className="w-full" disabled={isVerifying}>
                {isVerifying
                  ? "Verifying..."
                  : quizSet.isFreeMock && hasStoredAttempt
                    ? "Continue attempt"
                    : "Start quiz set"}
              </Button>
            </form>
          )}
        </section>
      )}

      {step === "taking" && sections ? (
        <ContentLeakGuard
          watermark={`${quizSet.title} · ${accessCode.trim().toUpperCase() || "QuizDesk"}`}
        >
          <section className="space-y-10">
            <div className="sticky top-0 z-10 -mx-6 border-b bg-background/95 px-6 py-4 backdrop-blur">
              <div className="flex items-center justify-between gap-4 text-sm">
                <p className="text-muted-foreground">
                  {answeredCount} of {totalQuestions} answered
                  {expiredUnansweredCount > 0
                    ? ` · ${expiredUnansweredCount} timed out`
                    : ""}
                </p>
                <div className="flex items-center gap-3 font-medium">
                  {remainingMs !== undefined ? (
                    <span
                      className={cn(
                        "inline-flex items-center gap-1.5 tabular-nums",
                        remainingMs <= WARN_5_MS && "text-destructive",
                      )}
                    >
                      <Clock3 className="size-4" />
                      {formatCountdown(remainingMs)}
                    </span>
                  ) : null}
                  <span>{progress}%</span>
                </div>
              </div>
              <div className="mt-3 h-2 overflow-hidden border bg-muted">
                <div
                  className="h-full bg-primary transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {sections.map((section) => {
                  const done = section.questions.every(
                    (q) =>
                      answers[q.id] ||
                      getQuestionStatus(q, nowMs).status === "expired",
                  );
                  return (
                    <a
                      key={section.id}
                      href={`#section-${section.id}`}
                      className={cn(
                        "border px-3 py-1 text-xs transition-colors",
                        done
                          ? "border-foreground bg-foreground text-background"
                          : "hover:bg-muted",
                      )}
                    >
                      {section.subject.name}
                    </a>
                  );
                })}
              </div>
            </div>

            {sections.map((section) => (
              <SubjectSection
                key={section.id}
                section={section}
                answers={answers}
                nowMs={nowMs}
                startingQuestionIds={startingQuestionIds}
                disabled={isSubmitting}
                onStart={handleStartQuestion}
                onSelect={selectOption}
              />
            ))}

            <div className="flex justify-end border-t pt-6">
              <Button
                type="button"
                size="lg"
                onClick={() => void submitQuiz(false)}
                disabled={isSubmitting}
              >
                {isSubmitting ? "Submitting..." : "Submit entire set"}
                <CheckCircle2 className="size-4" />
              </Button>
            </div>
          </section>
        </ContentLeakGuard>
      ) : null}
    </PublicPageShell>
  );
}

function SubjectSection({
  section,
  answers,
  nowMs,
  startingQuestionIds,
  disabled = false,
  onStart,
  onSelect,
}: {
  section: PublicQuizSection;
  answers: Record<string, string>;
  nowMs: number;
  startingQuestionIds: Set<string>;
  disabled?: boolean;
  onStart: (questionId: string) => void;
  onSelect: (question: PublicQuizQuestion, optionId: string) => void;
}) {
  return (
    <div id={`section-${section.id}`} className="scroll-mt-28 space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b pb-4">
        <div>
          <p className="text-xs font-medium tracking-[0.14em] text-muted-foreground uppercase">
            Subject section
          </p>
          <h2 className="mt-1 font-display text-3xl tracking-tight">
            {section.subject.name}
          </h2>
        </div>
        <p className="text-sm font-medium text-muted-foreground">
          {section.fullMarks} marks · {section.questions.length} questions
        </p>
      </div>

      <div className="space-y-4">
        {section.questions.map((question) => {
          const { status, remainingMs } = getQuestionStatus(question, nowMs);

          return (
            <QuestionCard
              key={question.id}
              question={question}
              status={status}
              remainingMs={remainingMs}
              selectedOptionId={answers[question.id]}
              disabled={disabled}
              isStarting={startingQuestionIds.has(question.id)}
              onStart={onStart}
              onSelect={onSelect}
            />
          );
        })}
      </div>
    </div>
  );
}

function MetaChip({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <span className="inline-flex items-center gap-2 border px-3 py-1.5">
      {icon}
      {label}
    </span>
  );
}
