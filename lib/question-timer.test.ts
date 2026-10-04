import { describe, expect, test } from "bun:test";

import {
  isQuestionExpired,
  questionExpiresAt,
  totalTimeLimitSeconds,
  validateDuration,
} from "./question-timer";

const start = new Date("2026-01-01T10:00:00Z");

describe("isQuestionExpired", () => {
  test("not expired at the exact limit", () => {
    const now = new Date(start.getTime() + 60_000);
    expect(isQuestionExpired(start, 60, now)).toBe(false);
  });

  test("expired one ms after the limit", () => {
    const now = new Date(start.getTime() + 60_001);
    expect(isQuestionExpired(start, 60, now)).toBe(true);
  });

  test("grace extends the window", () => {
    const now = new Date(start.getTime() + 62_000);
    expect(isQuestionExpired(start, 60, now, 3_000)).toBe(false);
    expect(isQuestionExpired(start, 60, now, 1_000)).toBe(true);
  });
});

describe("questionExpiresAt", () => {
  test("adds seconds to start", () => {
    expect(questionExpiresAt(start, 90).toISOString()).toBe(
      "2026-01-01T10:01:30.000Z",
    );
  });
});

describe("validateDuration", () => {
  test("accepts limits within the overall time, regardless of sum", () => {
    expect(validateDuration([3000, 3000, 3000], 60)).toEqual({
      ok: true,
      minutes: 60,
    });
  });

  test("rejects a question longer than the overall time", () => {
    expect(validateDuration([3601], 60).ok).toBe(false);
    expect(validateDuration([3600], 60).ok).toBe(true);
  });

  test("duration is always required", () => {
    expect(validateDuration([], undefined).ok).toBe(false);
    expect(validateDuration([60], 0).ok).toBe(false);
    expect(validateDuration([60], 1.5).ok).toBe(false);
  });

  test("rejects over the maximum", () => {
    expect(validateDuration([null], 601).ok).toBe(false);
  });
});

describe("totalTimeLimitSeconds", () => {
  test("sums timed questions only", () => {
    expect(totalTimeLimitSeconds([60, null, 30])).toBe(90);
  });
});
