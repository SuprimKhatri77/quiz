"use client";

import { useState } from "react";
import { ClipboardPaste, Eraser } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  PASTE_QUESTIONS_FORMAT_HELP,
  parsePastedQuestions,
  parsedQuestionsToDrafts,
} from "@/modules/admin/lib/parse-pasted-questions";

type QuestionDraft = {
  id: string;
  prompt: string;
  marks: number;
  timeLimitSeconds: number | null;
  options: Array<{ id: string; label: string; isCorrect: boolean }>;
};

export function SectionQuestionsPastePanel({
  sectionId,
  questionCount,
  onApply,
  onClearAll,
}: {
  sectionId: string;
  questionCount: number;
  onApply: (questions: QuestionDraft[], mode: "replace" | "append") => void;
  onClearAll: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [clearDialogOpen, setClearDialogOpen] = useState(false);
  const [raw, setRaw] = useState("");
  const [append, setAppend] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const pasteId = `paste-questions-${sectionId}`;
  const appendId = `paste-append-${sectionId}`;

  function handleParse() {
    const result = parsePastedQuestions(raw);

    if (result.errors.length > 0) {
      setParseErrors(result.errors.map((error) => error.message));
      toast.error(
        result.questions.length === 0
          ? (result.errors[0]?.message ?? "Could not parse questions.")
          : `Found ${result.errors.length} error(s). Fix the paste text and try again.`,
      );
      return;
    }

    const drafts = parsedQuestionsToDrafts(result.questions);
    const mode = append ? "append" : "replace";
    onApply(drafts, mode);
    setParseErrors([]);
    setRaw("");
    setOpen(false);
    toast.success(
      mode === "append"
        ? `Appended ${drafts.length} question(s).`
        : `Filled ${drafts.length} question(s).`,
    );
  }

  function requestClearAll() {
    setClearDialogOpen(true);
  }

  function confirmClearAll() {
    onClearAll();
    setClearDialogOpen(false);
    toast.success("Questions cleared.");
  }

  return (
    <div className="space-y-3 border-b px-5 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setOpen((current) => !current)}
        >
          <ClipboardPaste className="size-4" />
          {open ? "Hide paste" : "Paste questions"}
        </Button>
        {questionCount > 1 ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            onClick={requestClearAll}
          >
            <Eraser className="size-4" />
            Clear all
          </Button>
        ) : null}
      </div>

      <Dialog open={clearDialogOpen} onOpenChange={setClearDialogOpen}>
        <DialogContent showCloseButton={false} className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Clear all questions?</DialogTitle>
            <DialogDescription>
              This will remove all {questionCount} questions in this section and
              leave one empty question. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setClearDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={confirmClearAll}
            >
              Clear all
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {open ? (
        <div className="space-y-3 border bg-background p-4">
          <div className="space-y-1.5">
            <Label htmlFor={pasteId}>Paste text</Label>
            <Textarea
              id={pasteId}
              value={raw}
              onChange={(event) => {
                setRaw(event.target.value);
                if (parseErrors.length > 0) setParseErrors([]);
              }}
              rows={8}
              placeholder={PASTE_QUESTIONS_FORMAT_HELP}
              className="font-mono text-xs leading-5"
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Checkbox
                id={appendId}
                checked={append}
                onCheckedChange={(checked) => setAppend(checked === true)}
              />
              <Label htmlFor={appendId} className="font-normal">
                Append to existing questions
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setShowHelp((current) => !current)}
              >
                {showHelp ? "Hide format" : "Format help"}
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={handleParse}
                disabled={raw.trim().length === 0}
              >
                Parse & fill
              </Button>
            </div>
          </div>

          {showHelp ? (
            <pre
              className={cn(
                "overflow-x-auto rounded-lg border bg-muted/40 p-3",
                "font-mono text-xs leading-5 text-muted-foreground",
              )}
            >
              {PASTE_QUESTIONS_FORMAT_HELP}
            </pre>
          ) : null}

          {parseErrors.length > 0 ? (
            <ul className="space-y-1 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {parseErrors.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          ) : null}

          <p className="text-xs text-muted-foreground">
            Numbered lists work too (
            <code className="rounded bg-muted px-1">1. …</code> then stem, then{" "}
            <code className="rounded bg-muted px-1">a–d</code>). Extra prompt
            lines stay on separate lines. Mark the correct option with{" "}
            <code className="rounded bg-muted px-1">*</code> or add{" "}
            <code className="rounded bg-muted px-1">Correct: C</code>.
            {!append
              ? " Replace mode overwrites this section’s questions."
              : null}
          </p>
        </div>
      ) : null}
    </div>
  );
}
