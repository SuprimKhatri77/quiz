"use client";

import { Maximize2 } from "lucide-react";

import { Button } from "@/components/ui/button";

export function LockdownBriefing({
  allowedLeaves,
  isStarting,
  onStart,
  onBack,
}: {
  allowedLeaves: number;
  isStarting: boolean;
  onStart: () => void;
  onBack: () => void;
}) {
  return (
    <section className="w-full max-w-lg space-y-5 border bg-card p-6 md:p-8">
      <div className="space-y-2">
        <p className="text-xs font-medium tracking-[0.18em] text-muted-foreground uppercase">
          Exam rules
        </p>
        <h2 className="font-display text-3xl tracking-tight">
          This exam runs in lockdown mode
        </h2>
      </div>

      <ul className="list-disc space-y-2 pl-5 text-sm leading-6 text-muted-foreground">
        <li>The exam opens in fullscreen. Stay in this window until you submit.</li>
        <li>
          Switching tabs, switching apps, exiting fullscreen, or refreshing or
          closing the page counts as leaving the exam.
        </li>
        <li>
          {allowedLeaves === 0
            ? "Leaving even once cancels your attempt."
            : `You may leave up to ${allowedLeaves} time${allowedLeaves === 1 ? "" : "s"}. Leaving more than that cancels your attempt.`}
        </li>
        <li>A cancelled attempt is void. Only an administrator can reopen it.</li>
        <li>Your timer starts as soon as you press the button below.</li>
      </ul>

      <div className="flex flex-wrap gap-3">
        <Button type="button" onClick={onStart} disabled={isStarting}>
          <Maximize2 className="size-4" />
          {isStarting ? "Starting..." : "Enter fullscreen and start"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={onBack}
          disabled={isStarting}
        >
          Back
        </Button>
      </div>
    </section>
  );
}
