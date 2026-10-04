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
  id,
  value,
  onChange,
  disabled,
}: {
  id: string;
  value: number | null;
  onChange: (value: number | null) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <Label htmlFor={id} className="shrink-0 text-xs text-muted-foreground">
        Time (sec)
      </Label>
      <Input
        id={id}
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
    </div>
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

/** Overall duration input: read-only and derived when every question is timed. */
export function DurationField({
  id,
  value,
  onChange,
  derivedMinutes,
  error,
  disabled,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  derivedMinutes: number | null;
  error?: string;
  disabled?: boolean;
}) {
  const derived = derivedMinutes !== null;

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>Duration (minutes)</Label>
      <Input
        id={id}
        type="number"
        min={1}
        value={derived ? derivedMinutes : value}
        readOnly={derived}
        disabled={disabled}
        aria-invalid={Boolean(error)}
        onChange={(event) => onChange(event.target.value)}
      />
      <p className="text-xs text-muted-foreground">
        {derived
          ? "Calculated from the question times (sum, rounded up)."
          : "Required hard cap. Not every question is timed, so set the overall time."}
      </p>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
