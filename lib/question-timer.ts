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

/**
 * Overall exam minutes when every question is timed: the sum of the limits,
 * rounded up to whole minutes. Returns null if any question is untimed (or
 * there are no questions), meaning the admin must set the duration.
 */
export function derivedDurationMinutes(
  timeLimits: ReadonlyArray<number | null | undefined>,
): number | null {
  if (timeLimits.length === 0) {
    return null;
  }

  let totalSeconds = 0;

  for (const limit of timeLimits) {
    if (limit == null) {
      return null;
    }
    totalSeconds += limit;
  }

  return Math.ceil(totalSeconds / 60);
}

export const MAX_DURATION_MINUTES = 600;

export type DurationResolution =
  | { ok: true; minutes: number; derived: boolean }
  | { ok: false; message: string };

/**
 * Overall duration for a quiz set. All questions timed -> derived from the sum
 * (any admin-provided value is ignored). Otherwise the admin must provide it.
 */
export function resolveDurationMinutes(
  timeLimits: ReadonlyArray<number | null | undefined>,
  provided: number | null | undefined,
): DurationResolution {
  const derived = derivedDurationMinutes(timeLimits);

  if (derived !== null) {
    if (derived > MAX_DURATION_MINUTES) {
      return {
        ok: false,
        message: `Question times add up to ${derived} minutes; the maximum is ${MAX_DURATION_MINUTES}.`,
      };
    }
    return { ok: true, minutes: derived, derived: true };
  }

  if (provided == null || !Number.isInteger(provided) || provided <= 0) {
    return {
      ok: false,
      message:
        "Set the overall duration — it is required unless every question has its own time.",
    };
  }

  if (provided > MAX_DURATION_MINUTES) {
    return {
      ok: false,
      message: `Duration must be at most ${MAX_DURATION_MINUTES} minutes.`,
    };
  }

  return { ok: true, minutes: provided, derived: false };
}
