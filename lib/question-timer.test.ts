import { describe, expect, test } from "bun:test";

import {
  derivedDurationMinutes,
  isQuestionExpired,
  resolveDurationMinutes,
  questionExpiresAt,
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

describe("derivedDurationMinutes", () => {
  test("sums and rounds up when all timed", () => {
    expect(derivedDurationMinutes([60, 90, 45])).toBe(4);
  });

  test("null when any question is untimed", () => {
    expect(derivedDurationMinutes([60, null, 45])).toBeNull();
  });

  test("null when there are no questions", () => {
    expect(derivedDurationMinutes([])).toBeNull();
  });
});

describe("resolveDurationMinutes", () => {
  test("derives when all timed and ignores provided value", () => {
    expect(resolveDurationMinutes([60, 60], 999)).toEqual({
      ok: true,
      minutes: 2,
      derived: true,
    });
  });

  test("requires provided duration when mixed", () => {
    expect(resolveDurationMinutes([60, null], undefined).ok).toBe(false);
    expect(resolveDurationMinutes([60, null], 30)).toEqual({
      ok: true,
      minutes: 30,
      derived: false,
    });
  });

  test("rejects derived total over the maximum", () => {
    expect(resolveDurationMinutes(Array(11).fill(3600), undefined).ok).toBe(
      false,
    );
  });

  test("rejects non-positive or oversized provided value", () => {
    expect(resolveDurationMinutes([null], 0).ok).toBe(false);
    expect(resolveDurationMinutes([null], 601).ok).toBe(false);
  });
});
