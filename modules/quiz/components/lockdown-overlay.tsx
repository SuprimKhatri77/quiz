"use client";

import { Button } from "@/components/ui/button";

/** Covers the exam while the student is away or out of fullscreen. */
export function LockdownOverlay({ onReturn }: { onReturn: () => void }) {
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-background p-6"
    >
      <div className="max-w-md space-y-4 border bg-card p-6 text-center">
        <h2 className="font-display text-2xl tracking-tight">
          Return to the exam
        </h2>
        <p className="text-sm leading-6 text-muted-foreground">
          The exam is hidden while you are away from this window or out of
          fullscreen. Your timer is still running.
        </p>
        <Button type="button" onClick={onReturn}>
          Return to fullscreen
        </Button>
      </div>
    </div>
  );
}
