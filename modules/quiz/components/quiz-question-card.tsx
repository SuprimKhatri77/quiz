"use client";

import { Clock3, Lock } from "lucide-react";

import { MathText } from "@/components/math-text";
import { Button } from "@/components/ui/button";
import type { PublicQuizQuestion } from "@/dal/public/get-quiz-set";
import { cn } from "@/lib/utils";

const OPTION_LETTERS = ["A", "B", "C", "D"] as const;

export type QuestionStatus = "untimed" | "locked" | "running" | "expired";

export function formatCountdown(ms: number) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/**
 * `nowMs` must already be corrected to server time (see the clock offset in the
 * page) so a skewed client clock can't extend or cut a question's window.
 */
export function getQuestionStatus(
  question: PublicQuizQuestion,
  nowMs: number,
): { status: QuestionStatus; remainingMs: number | null } {
  if (question.timeLimitSeconds === null) {
    return { status: "untimed", remainingMs: null };
  }

  if (!question.startedAt) {
    return { status: "locked", remainingMs: null };
  }

  const remainingMs =
    new Date(question.startedAt).getTime() +
    question.timeLimitSeconds * 1000 -
    nowMs;

  return remainingMs > 0
    ? { status: "running", remainingMs }
    : { status: "expired", remainingMs: 0 };
}

export function QuestionCard({
  question,
  status,
  remainingMs,
  selectedOptionId,
  disabled,
  isStarting,
  onStart,
  onSelect,
}: {
  question: PublicQuizQuestion;
  status: QuestionStatus;
  remainingMs: number | null;
  selectedOptionId: string | undefined;
  disabled: boolean;
  isStarting: boolean;
  onStart: (questionId: string) => void;
  onSelect: (question: PublicQuizQuestion, optionId: string) => void;
}) {
  const optionsLocked = disabled || status === "expired";

  return (
    <article
      className={cn(
        "border bg-card p-5 md:p-6",
        status === "expired" && "opacity-80",
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="font-mono text-xs tracking-wide text-muted-foreground uppercase">
          Q{question.position}
        </p>

        {status === "running" && remainingMs !== null ? (
          <span
            className={cn(
              "inline-flex items-center gap-1.5 text-sm font-medium tabular-nums",
              remainingMs <= 10_000 && "text-destructive",
            )}
          >
            <Clock3 className="size-4" />
            {formatCountdown(remainingMs)}
          </span>
        ) : null}

        {status === "expired" ? (
          <span className="inline-flex items-center gap-1.5 border px-2 py-0.5 text-xs font-medium text-destructive">
            <Lock className="size-3.5" />
            Time&apos;s up
          </span>
        ) : null}
      </div>

      {question.content === null ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border border-dashed px-4 py-5">
          <p className="text-sm text-muted-foreground">
            Timed question —{" "}
            {formatCountdown((question.timeLimitSeconds ?? 0) * 1000)} once you
            start. The question is shown when you press Start.
          </p>
          <Button
            type="button"
            size="sm"
            onClick={() => onStart(question.id)}
            disabled={disabled || isStarting}
          >
            {isStarting ? "Starting..." : "Start"}
          </Button>
        </div>
      ) : (
        <>
          <MathText
            as="h3"
            text={question.content.prompt}
            className="mt-2 text-base font-medium leading-7 md:text-lg"
          />

          <div className="mt-5 space-y-2.5">
            {question.content.options.map((option, index) => {
              const selected = selectedOptionId === option.id;

              return (
                <button
                  key={option.id}
                  type="button"
                  disabled={optionsLocked}
                  onClick={() => onSelect(question, option.id)}
                  className={cn(
                    "flex w-full items-start gap-3 border px-4 py-3.5 text-left transition-colors",
                    selected ? "border-foreground bg-muted" : "hover:bg-muted/60",
                    optionsLocked &&
                      "cursor-not-allowed opacity-60 hover:bg-transparent",
                    optionsLocked && selected && "hover:bg-muted",
                  )}
                >
                  <span
                    className={cn(
                      "mt-0.5 flex size-7 shrink-0 items-center justify-center border text-xs font-medium",
                      selected &&
                        "border-foreground bg-foreground text-background",
                    )}
                  >
                    {OPTION_LETTERS[index]}
                  </span>
                  <MathText text={option.label} className="text-sm leading-6" />
                </button>
              );
            })}
          </div>

          {status === "expired" && !selectedOptionId ? (
            <p className="mt-4 text-sm text-muted-foreground">
              Time ran out before you answered this question.
            </p>
          ) : null}
        </>
      )}
    </article>
  );
}
