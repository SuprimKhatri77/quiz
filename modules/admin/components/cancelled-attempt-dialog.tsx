"use client";

import { useState } from "react";
import { toast } from "sonner";

import { reopenCancelledAttempt } from "@/actions/admin/codes/reopen-attempt";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { CancelledAttemptInfo } from "@/dal/admin/get-access-codes";

const REASON_LABELS: Record<string, string> = {
  hidden: "Tab hidden",
  blur: "Window lost focus",
  fullscreen_exit: "Exited fullscreen",
  unload: "Page closed / refreshed",
};

export function CancelledAttemptDialog({
  code,
  attempt,
  onOpenChange,
  onReopened,
}: {
  code: string;
  attempt: CancelledAttemptInfo | null;
  onOpenChange: (open: boolean) => void;
  onReopened: () => void | Promise<void>;
}) {
  const [isPending, setIsPending] = useState(false);

  async function handleReopen() {
    if (!attempt) {
      return;
    }

    setIsPending(true);

    try {
      const result = await reopenCancelledAttempt({ attemptId: attempt.attemptId });

      if (!result.success) {
        toast.error(result.message);
        return;
      }

      toast.success(result.message ?? "Attempt reopened.");
      onOpenChange(false);
      await onReopened();
    } finally {
      setIsPending(false);
    }
  }

  return (
    <Dialog open={Boolean(attempt)} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Cancelled attempt · {code}</DialogTitle>
          <DialogDescription>
            {attempt?.reason ?? "The student left the exam window."}
          </DialogDescription>
        </DialogHeader>

        {attempt ? (
          <div className="max-h-64 space-y-2 overflow-y-auto text-sm">
            <p className="text-xs text-muted-foreground">
              Cancelled {attempt.cancelledAt}
            </p>
            {attempt.events.length === 0 ? (
              <p className="text-muted-foreground">No leave events recorded.</p>
            ) : (
              <ul className="divide-y border">
                {attempt.events.map((event) => (
                  <li
                    key={event.id}
                    className="flex items-center justify-between gap-3 px-3 py-2"
                  >
                    <span>
                      {REASON_LABELS[event.reason] ?? event.reason}
                      {event.countsAsStrike ? "" : " (ignored: too short)"}
                      {event.forgiven ? " (forgiven)" : ""}
                    </span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {event.durationMs !== null
                        ? `${(event.durationMs / 1000).toFixed(1)}s · `
                        : ""}
                      {new Date(event.occurredAt).toLocaleString()}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            Close
          </Button>
          <Button type="button" onClick={handleReopen} disabled={isPending}>
            {isPending ? "Reopening..." : "Reset attempt (let student resume)"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
