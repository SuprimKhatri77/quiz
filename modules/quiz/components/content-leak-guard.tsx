"use client";

import {
  useEffect,
  type DragEvent,
  type ReactNode,
  type ClipboardEvent,
  type MouseEvent,
} from "react";

import { cn } from "@/lib/utils";

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return Boolean(
    target.closest("input, textarea, select, [contenteditable='true']"),
  );
}

/**
 * Soft leak deterrents for assessment content.
 * Cannot block OS screenshots or screen recording in the browser.
 */
export function ContentLeakGuard({
  children,
  watermark,
  className,
  lockdown = false,
}: {
  /** Also block dev-tools/save/print/view-source shortcuts and hide on print. */
  lockdown?: boolean;
  children: ReactNode;
  /** Traceable label shown as a faint repeating watermark (e.g. quiz + code). */
  watermark?: string;
  className?: string;
}) {
  useEffect(() => {
    function blockClipboard(event: Event) {
      if (isEditableTarget(event.target)) {
        return;
      }
      event.preventDefault();
    }

    function blockContextMenu(event: Event) {
      if (isEditableTarget(event.target)) {
        return;
      }
      event.preventDefault();
    }

    function blockShortcuts(event: KeyboardEvent) {
      if (isEditableTarget(event.target)) {
        return;
      }

      const key = event.key.toLowerCase();
      const mod = event.ctrlKey || event.metaKey;
      const blocked =
        event.key === "F12" ||
        (mod && event.shiftKey && ["i", "j", "c"].includes(key)) ||
        (mod && ["u", "s", "p"].includes(key)) ||
        event.key === "PrintScreen";

      if (blocked) {
        event.preventDefault();
        event.stopPropagation();
      }
    }

    document.addEventListener("copy", blockClipboard, true);
    document.addEventListener("cut", blockClipboard, true);
    document.addEventListener("contextmenu", blockContextMenu, true);

    if (lockdown) {
      document.addEventListener("keydown", blockShortcuts, true);
    }

    return () => {
      document.removeEventListener("keydown", blockShortcuts, true);
      document.removeEventListener("copy", blockClipboard, true);
      document.removeEventListener("cut", blockClipboard, true);
      document.removeEventListener("contextmenu", blockContextMenu, true);
    };
  }, [lockdown]);

  function handleCopy(event: ClipboardEvent<HTMLDivElement>) {
    if (!isEditableTarget(event.target)) {
      event.preventDefault();
    }
  }

  function handleContextMenu(event: MouseEvent<HTMLDivElement>) {
    if (!isEditableTarget(event.target)) {
      event.preventDefault();
    }
  }

  function handleDragStart(event: DragEvent<HTMLDivElement>) {
    if (!isEditableTarget(event.target)) {
      event.preventDefault();
    }
  }

  return (
    <div
      className={cn(
        "content-leak-guard relative select-none",
        lockdown && "print:hidden",
        "[&_input]:select-text [&_textarea]:select-text",
        className,
      )}
      onCopy={handleCopy}
      onCut={handleCopy}
      onContextMenu={handleContextMenu}
      onDragStart={handleDragStart}
    >
      {watermark ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-0 overflow-hidden"
        >
          <div
            className="absolute inset-[-40%] flex flex-wrap content-center gap-x-16 gap-y-24 opacity-[0.06]"
            style={{ transform: "rotate(-24deg)" }}
          >
            {Array.from({ length: 48 }).map((_, index) => (
              <span
                key={index}
                className="shrink-0 whitespace-nowrap font-mono text-sm tracking-wide"
              >
                {watermark}
              </span>
            ))}
          </div>
        </div>
      ) : null}
      <div className="relative z-10">{children}</div>
    </div>
  );
}
