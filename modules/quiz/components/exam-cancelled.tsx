"use client";

import Link from "next/link";
import { OctagonX } from "lucide-react";

export function ExamCancelled({ backHref }: { backHref: string }) {
  return (
    <section className="w-full max-w-lg space-y-4 border bg-card p-6 md:p-8">
      <div className="flex items-center gap-3">
        <OctagonX className="size-6 text-destructive" />
        <h2 className="font-display text-3xl tracking-tight">
          Exam cancelled
        </h2>
      </div>
      <p className="text-sm leading-6 text-muted-foreground">
        Your attempt was cancelled because you left the exam window more times
        than allowed. The attempt is void. If this was a mistake, such as a lost
        connection, contact your administrator to reopen it.
      </p>
      <Link href={backHref} className="text-sm underline underline-offset-4">
        Back to the faculty page
      </Link>
    </section>
  );
}
