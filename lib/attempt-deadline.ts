/** Grace after the overall deadline before submit/resume treat it as expired. */
export const DEADLINE_GRACE_MS = 30_000;

export function overallDeadlineAt(
  startedAt: Date,
  durationMinutes: number,
): Date {
  return new Date(startedAt.getTime() + durationMinutes * 60_000);
}

export function isPastOverallDeadline(
  startedAt: Date,
  durationMinutes: number,
  now: Date,
  graceMs = DEADLINE_GRACE_MS,
): boolean {
  return (
    now.getTime() >
    overallDeadlineAt(startedAt, durationMinutes).getTime() + graceMs
  );
}
