/** Extra time the server allows for network latency when saving an answer. */
export const QUESTION_SAVE_GRACE_MS = 3_000;

export const MIN_QUESTION_TIME_SECONDS = 10;
export const MAX_QUESTION_TIME_SECONDS = 3_600;

export function questionExpiresAt(
  startedAt: Date,
  timeLimitSeconds: number,
): Date {
  return new Date(startedAt.getTime() + timeLimitSeconds * 1000);
}

/** True once the question's own countdown has run out (plus optional grace). */
export function isQuestionExpired(
  startedAt: Date,
  timeLimitSeconds: number,
  now: Date,
  graceMs = 0,
): boolean {
  return (
    now.getTime() >
    questionExpiresAt(startedAt, timeLimitSeconds).getTime() + graceMs
  );
}

export const MAX_DURATION_MINUTES = 600;

/** Total of all question limits in seconds (untimed questions count as 0). Informational only. */
export function totalTimeLimitSeconds(
  timeLimits: ReadonlyArray<number | null | undefined>,
): number {
  return timeLimits.reduce<number>((sum, limit) => sum + (limit ?? 0), 0);
}

export type DurationValidation =
  | { ok: true; minutes: number }
  | { ok: false; message: string };

/**
 * The admin always sets the overall time (hard cap). Every question's own
 * limit must fit inside it; the sum of limits is deliberately unconstrained
 * because students can run several timers at once.
 */
export function validateDuration(
  timeLimits: ReadonlyArray<number | null | undefined>,
  provided: number | null | undefined,
): DurationValidation {
  if (provided == null || !Number.isInteger(provided) || provided <= 0) {
    return { ok: false, message: "Set the overall duration in minutes." };
  }

  if (provided > MAX_DURATION_MINUTES) {
    return {
      ok: false,
      message: `Duration must be at most ${MAX_DURATION_MINUTES} minutes.`,
    };
  }

  const longest = Math.max(0, ...timeLimits.map((limit) => limit ?? 0));

  if (longest > provided * 60) {
    return {
      ok: false,
      message: `A question time (${longest}s) is longer than the overall duration (${provided} min).`,
    };
  }

  return { ok: true, minutes: provided };
}
