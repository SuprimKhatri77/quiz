/** Leaves shorter than this are ignored (notifications, misclicks). */
export const MIN_LEAVE_MS = 3_000;
export const MAX_ALLOWED_LEAVES = 10;

export const LEAVE_REASONS = [
  "hidden",
  "blur",
  "fullscreen_exit",
  "unload",
] as const;

export type LeaveReason = (typeof LEAVE_REASONS)[number];

export type LeaveEvaluation = {
  countsAsStrike: boolean;
  /** Strikes including this event (when it counts). */
  strikes: number;
  /** True once strikes exceed the allowed leaves. */
  cancelled: boolean;
};

/**
 * Whether a reported leave is a strike and whether it cancels the attempt.
 * An unload (page closed/navigated/refreshed) has no duration and always
 * counts; other leaves count only if they lasted at least MIN_LEAVE_MS.
 */
export function evaluateLeave({
  reason,
  durationMs,
  currentStrikes,
  allowedLeaves,
}: {
  reason: LeaveReason;
  durationMs: number | null;
  currentStrikes: number;
  allowedLeaves: number;
}): LeaveEvaluation {
  const countsAsStrike =
    reason === "unload" || (durationMs !== null && durationMs >= MIN_LEAVE_MS);
  const strikes = currentStrikes + (countsAsStrike ? 1 : 0);

  return {
    countsAsStrike,
    strikes,
    cancelled: countsAsStrike && strikes > allowedLeaves,
  };
}
