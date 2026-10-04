"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { reportLeave } from "@/actions/quiz/report-leave";
import { MIN_LEAVE_MS, type LeaveReason } from "@/lib/lockdown";

export function isFullscreenSupported() {
  return typeof document !== "undefined" && document.fullscreenEnabled === true;
}

export async function enterFullscreen() {
  if (!isFullscreenSupported() || document.fullscreenElement) {
    return;
  }

  try {
    await document.documentElement.requestFullscreen();
  } catch {
    // Denied or unsupported: the hook shows the overlay until fullscreen is active.
  }
}

export async function exitFullscreen() {
  if (typeof document === "undefined" || !document.fullscreenElement) {
    return;
  }

  try {
    await document.exitFullscreen();
  } catch {
    // Nothing to do.
  }
}

/**
 * Detects the student leaving the exam (tab hidden, window blurred, fullscreen
 * exited) and reports each episode to the server, which decides if it counts
 * and cancels the attempt. A page unload is reported by beacon. Client-side
 * detection is a deterrent only; the server owns strike counting.
 */
export function useExamLockdown({
  enabled,
  attemptId,
  onWarning,
  onCancelled,
}: {
  enabled: boolean;
  attemptId: string | undefined;
  onWarning: (strikes: number, allowedLeaves: number) => void;
  onCancelled: () => void;
}) {
  const [isAway, setIsAway] = useState(false);
  const awaySinceRef = useRef<number | null>(null);
  const reasonRef = useRef<LeaveReason>("blur");
  // The attempt id while lockdown is armed (undefined otherwise); read by the unmount handler.
  const armedAttemptIdRef = useRef<string | undefined>(undefined);
  const onWarningRef = useRef(onWarning);
  const onCancelledRef = useRef(onCancelled);

  useEffect(() => {
    onWarningRef.current = onWarning;
    onCancelledRef.current = onCancelled;
  });

  const requestReturn = useCallback(() => {
    void enterFullscreen();
  }, []);

  useEffect(() => {
    if (!enabled || !attemptId) {
      return;
    }

    const activeAttemptId = attemptId;

    function isOut() {
      return (
        document.visibilityState === "hidden" ||
        !document.hasFocus() ||
        (isFullscreenSupported() && !document.fullscreenElement)
      );
    }

    // graceMs lets the initial state (fullscreen still being granted) settle
    // without charging the student, while a denied/never-entered fullscreen
    // still accrues time and is counted once they return.
    function begin(reason: LeaveReason, graceMs = 0) {
      if (awaySinceRef.current !== null) {
        return;
      }
      awaySinceRef.current = Date.now() + graceMs;
      reasonRef.current = reason;
      setIsAway(true);
    }

    async function end() {
      if (awaySinceRef.current === null) {
        return;
      }

      const durationMs = Date.now() - awaySinceRef.current;
      const reason = reasonRef.current;
      awaySinceRef.current = null;
      setIsAway(false);

      // Still inside the start-up grace: nothing to report.
      if (durationMs <= 0) {
        return;
      }

      // Retry a few times so a network blip can't be used to dodge a strike.
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const response = await reportLeave({
            attemptId: activeAttemptId,
            reason,
            durationMs,
          });

          if (!response.success) {
            return;
          }

          if (!response.data.tracked) {
            return;
          }

          if (response.data.cancelled) {
            onCancelledRef.current();
            return;
          }

          if (durationMs >= MIN_LEAVE_MS) {
            onWarningRef.current(
              response.data.strikes,
              response.data.allowedLeaves,
            );
          }
          return;
        } catch {
          await new Promise((resolve) => window.setTimeout(resolve, 1500));
        }
      }
    }

    function evaluate(reason: LeaveReason) {
      if (isOut()) {
        begin(reason);
      } else {
        void end();
      }
    }

    function onVisibility() {
      evaluate("hidden");
    }
    function onBlur() {
      // hasFocus() settles after the event loop turn.
      window.setTimeout(() => evaluate("blur"), 0);
    }
    function onFocus() {
      window.setTimeout(() => evaluate("blur"), 0);
    }
    function onFullscreen() {
      evaluate("fullscreen_exit");
    }
    function onPageHide() {
      navigator.sendBeacon(
        "/api/quiz/attempt-leave",
        JSON.stringify({ attemptId: activeAttemptId }),
      );
    }

    if (isOut()) {
      begin("fullscreen_exit", 1500);
    }

    document.addEventListener("visibilitychange", onVisibility);
    document.addEventListener("fullscreenchange", onFullscreen);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    window.addEventListener("pagehide", onPageHide);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("fullscreenchange", onFullscreen);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("pagehide", onPageHide);
      awaySinceRef.current = null;
      setIsAway(false);
    };
  }, [enabled, attemptId]);

  // In-app navigation (Link, Back) unmounts the page without a pagehide, so
  // treat leaving while still armed as a leave too.
  useEffect(() => {
    armedAttemptIdRef.current = enabled ? attemptId : undefined;
  }, [enabled, attemptId]);

  useEffect(() => {
    return () => {
      const armedAttemptId = armedAttemptIdRef.current;

      if (armedAttemptId) {
        navigator.sendBeacon(
          "/api/quiz/attempt-leave",
          JSON.stringify({ attemptId: armedAttemptId }),
        );
      }
    };
  }, []);

  return { isAway: enabled && isAway, requestReturn };
}
