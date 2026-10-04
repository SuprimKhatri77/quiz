"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  MAX_QUESTION_TIME_SECONDS,
  MIN_QUESTION_TIME_SECONDS,
} from "@/lib/question-timer";

/** Parses a seconds input: blank -> null (untimed), otherwise a number (validated by the schema). */
export function parseTimeInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return null;
  }
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

export function QuestionTimeField({
  value,
  onChange,
  disabled,
}: {
  value: number | null;
  onChange: (value: number | null) => void;
  disabled?: boolean;
}) {
  // The label wraps the input, so no id is needed (draft question ids are
  // random per render and would break hydration if used as DOM ids).
  return (
    <label className="flex items-center gap-2">
      <span className="shrink-0 text-xs text-muted-foreground">Time (sec)</span>
      <Input
        type="number"
        inputMode="numeric"
        min={MIN_QUESTION_TIME_SECONDS}
        max={MAX_QUESTION_TIME_SECONDS}
        placeholder="Untimed"
        className="h-8 w-28"
        value={value ?? ""}
        disabled={disabled}
        onChange={(event) => onChange(parseTimeInput(event.target.value))}
      />
    </label>
  );
}

/** Section-level shortcut: set (or clear) the same limit on every question. */
export function SectionTimeShortcut({
  onApply,
  disabled,
}: {
  onApply: (seconds: number | null) => void;
  disabled?: boolean;
}) {
  const [raw, setRaw] = useState("");
  const seconds = parseTimeInput(raw);
  const valid =
    seconds !== null &&
    Number.isInteger(seconds) &&
    seconds >= MIN_QUESTION_TIME_SECONDS &&
    seconds <= MAX_QUESTION_TIME_SECONDS;

  return (
    <div className="flex flex-wrap items-center gap-2 border-b px-5 py-3 text-sm">
      <span className="text-xs font-medium text-muted-foreground">
        Question time for this section
      </span>
      <Input
        type="number"
        inputMode="numeric"
        min={MIN_QUESTION_TIME_SECONDS}
        max={MAX_QUESTION_TIME_SECONDS}
        placeholder="Seconds"
        className="h-8 w-28"
        value={raw}
        disabled={disabled}
        onChange={(event) => setRaw(event.target.value)}
        aria-label="Seconds per question for this section"
      />
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={disabled || !valid}
        onClick={() => onApply(seconds)}
      >
        Apply to all questions
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled={disabled}
        onClick={() => onApply(null)}
      >
        Clear all
      </Button>
    </div>
  );
}

/** Overall duration (hard cap). Always required; each question limit must fit inside it. */
export function DurationField({
  id,
  value,
  onChange,
  totalQuestionSeconds,
  error,
  disabled,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  /** Sum of all question limits, shown for information only. */
  totalQuestionSeconds: number;
  error?: string;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>Duration (minutes)</Label>
      <Input
        id={id}
        type="number"
        min={1}
        value={value}
        disabled={disabled}
        aria-invalid={Boolean(error)}
        onChange={(event) => onChange(event.target.value)}
      />
      <p className="text-xs text-muted-foreground">
        Hard cap for the whole exam. Each question&apos;s time must be within it.
        {totalQuestionSeconds > 0
          ? ` Question times add up to ${Math.round(totalQuestionSeconds / 6) / 10} min (students can run several at once).`
          : ""}
      </p>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
