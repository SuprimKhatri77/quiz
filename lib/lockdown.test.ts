import { describe, expect, test } from "bun:test";

import { evaluateLeave, MIN_LEAVE_MS } from "./lockdown";

describe("evaluateLeave", () => {
  test("short leave is ignored", () => {
    expect(
      evaluateLeave({
        reason: "blur",
        durationMs: MIN_LEAVE_MS - 1,
        currentStrikes: 0,
        allowedLeaves: 0,
      }),
    ).toEqual({ countsAsStrike: false, strikes: 0, cancelled: false });
  });

  test("leave at the threshold counts", () => {
    expect(
      evaluateLeave({
        reason: "hidden",
        durationMs: MIN_LEAVE_MS,
        currentStrikes: 0,
        allowedLeaves: 1,
      }),
    ).toEqual({ countsAsStrike: true, strikes: 1, cancelled: false });
  });

  test("0 allowed leaves cancels on the first strike", () => {
    expect(
      evaluateLeave({
        reason: "fullscreen_exit",
        durationMs: 5000,
        currentStrikes: 0,
        allowedLeaves: 0,
      }).cancelled,
    ).toBe(true);
  });

  test("cancels only when strikes exceed allowed", () => {
    const base = { reason: "blur", durationMs: 5000, allowedLeaves: 2 } as const;
    expect(evaluateLeave({ ...base, currentStrikes: 1 }).cancelled).toBe(false);
    expect(evaluateLeave({ ...base, currentStrikes: 2 }).cancelled).toBe(true);
  });

  test("unload always counts, even without a duration", () => {
    expect(
      evaluateLeave({
        reason: "unload",
        durationMs: null,
        currentStrikes: 0,
        allowedLeaves: 0,
      }),
    ).toEqual({ countsAsStrike: true, strikes: 1, cancelled: true });
  });

  test("non-unload without a duration is ignored", () => {
    expect(
      evaluateLeave({
        reason: "blur",
        durationMs: null,
        currentStrikes: 0,
        allowedLeaves: 0,
      }).countsAsStrike,
    ).toBe(false);
  });
});
