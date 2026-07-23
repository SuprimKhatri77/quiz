"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState, useTransition } from "react";
import { ArrowLeft, ExternalLink, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { deleteQuizSet } from "@/actions/admin/quizzes/delete";
import { cloneQuizSetAsFreeMock } from "@/actions/admin/quizzes/clone-as-free-mock";
import {
  setQuizSetFreeMock,
  setQuizSetPublished,
  updateQuizSet,
  updateQuizSetMeta,
} from "@/actions/admin/quizzes/update";
import { MathSourceField } from "@/components/math-text";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type {
  AdminQuizSetDetail,
  SubjectOption,
} from "@/dal/admin/get-quiz-set";
import { cn } from "@/lib/utils";
import { getZodFieldErrors } from "@/lib/action-result";
import { slugify } from "@/lib/slugify";
import { ConfirmDeleteDialog } from "@/modules/admin/components/confirm-delete-dialog";
import { QuizQuestionsPreviewTrigger } from "@/modules/admin/components/quiz-questions-preview";
import { SectionQuestionsPastePanel } from "@/modules/admin/components/section-questions-paste-panel";
import { adminKeys } from "@/modules/admin/hooks/queries/keys";
import {
  cloneQuizSetAsFreeMockSchema,
  updateQuizSetMetaSchema,
  updateQuizSetSchema,
  type UpdateQuizSetInput,
  type UpdateQuizSetMetaInput,
} from "@/modules/admin/schemas/quiz-set";

type OptionDraft = {
  id: string;
  label: string;
  isCorrect: boolean;
};

type QuestionDraft = {
  id: string;
  prompt: string;
  marks: number;
  options: OptionDraft[];
};

type SectionDraft = {
  id: string;
  subjectId: string;
  subjectName: string;
  questions: QuestionDraft[];
};

type EditorState = {
  id: string;
  title: string;
  slug: string;
  description: string;
  durationMinutes: string;
  isPublished: boolean;
  isFreeMock: boolean;
  facultyId: string;
  facultyName: string;
  facultySlug: string;
  hasAttempts: boolean;
  sections: SectionDraft[];
};

function createEmptyOptions(): OptionDraft[] {
  return [1, 2, 3, 4].map((position) => ({
    id: `opt-${position}-${Math.random().toString(36).slice(2, 7)}`,
    label: "",
    isCorrect: position === 1,
  }));
}

function createEmptyQuestion(): QuestionDraft {
  return {
    id: `q-${Math.random().toString(36).slice(2, 9)}`,
    prompt: "",
    marks: 1,
    options: createEmptyOptions(),
  };
}

function createEmptySection(
  subjectId: string,
  subjectName: string,
): SectionDraft {
  return {
    id: `sec-${Math.random().toString(36).slice(2, 9)}`,
    subjectId,
    subjectName,
    questions: [createEmptyQuestion()],
  };
}

function sectionMarksTotal(questions: QuestionDraft[]) {
  return questions.reduce((sum, question) => sum + question.marks, 0);
}

function isClientDraftId(id: string, prefix: "q-" | "sec-") {
  return id.startsWith(prefix);
}

/** Snapshot of quiz structure only (ignores title/publish/etc.). */
function structureSignature(sections: SectionDraft[]) {
  return JSON.stringify(
    sections.map((section) => ({
      id: isClientDraftId(section.id, "sec-") ? null : section.id,
      subjectId: section.subjectId,
      questions: section.questions.map((question) => ({
        id: isClientDraftId(question.id, "q-") ? null : question.id,
        prompt: question.prompt,
        marks: question.marks,
        options: question.options.map((option) => ({
          label: option.label,
          isCorrect: option.isCorrect,
        })),
      })),
    })),
  );
}

function toEditorState(quizSet: AdminQuizSetDetail): EditorState {
  return {
    id: quizSet.id,
    title: quizSet.title,
    slug: quizSet.slug,
    description: quizSet.description ?? "",
    durationMinutes: String(quizSet.durationMinutes),
    isPublished: quizSet.isPublished,
    isFreeMock: quizSet.isFreeMock,
    facultyId: quizSet.facultyId,
    facultyName: quizSet.facultyName,
    facultySlug: quizSet.facultySlug,
    hasAttempts: quizSet.hasAttempts,
    sections: quizSet.sections.map((section) => ({
      id: section.id,
      subjectId: section.subjectId,
      subjectName: section.subjectName,
      questions: section.questions.map((question) => ({
        id: question.id,
        prompt: question.prompt,
        marks: question.marks,
        options: question.options.map((option) => ({
          id: option.id,
          label: option.label,
          isCorrect: option.isCorrect,
        })),
      })),
    })),
  };
}

export function QuizDetailEditor({
  initialQuizSet,
  facultySubjects = [],
}: {
  initialQuizSet: AdminQuizSetDetail;
  facultySubjects?: SubjectOption[];
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [isPending, startTransition] = useTransition();
  const [isPublishPending, setIsPublishPending] = useState(false);
  const [isFreeMockPending, setIsFreeMockPending] = useState(false);
  const [quizSet, setQuizSet] = useState(() => toEditorState(initialQuizSet));
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<string, string>>
  >({});
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [cloneDialogOpen, setCloneDialogOpen] = useState(false);
  const [cloneTitle, setCloneTitle] = useState("");
  const [cloneSlug, setCloneSlug] = useState("");
  const [cloneSlugTouched, setCloneSlugTouched] = useState(false);
  const [cloneFieldErrors, setCloneFieldErrors] = useState<
    Partial<Record<string, string>>
  >({});
  const [pendingSectionDelete, setPendingSectionDelete] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [pendingQuestionDelete, setPendingQuestionDelete] = useState<{
    sectionId: string;
    questionId: string;
    label: string;
  } | null>(null);
  const locked = quizSet.hasAttempts;
  const structureBaselineRef = useRef(
    structureSignature(toEditorState(initialQuizSet).sections),
  );

  async function invalidateQuizLists() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: adminKeys.quizSetsRoot() }),
      queryClient.invalidateQueries({ queryKey: adminKeys.accessCodesRoot() }),
    ]);
  }

  const usedSubjectIds = new Set(
    quizSet.sections.map((section) => section.subjectId),
  );

  function updateSection(
    sectionId: string,
    updater: (section: SectionDraft) => SectionDraft,
  ) {
    if (locked) return;

    setQuizSet((current) => ({
      ...current,
      sections: current.sections.map((section) =>
        section.id === sectionId ? updater(section) : section,
      ),
    }));
  }

  function addSection() {
    if (locked) return;

    const nextSubject = facultySubjects.find(
      (subject) => !usedSubjectIds.has(subject.id),
    );

    if (!nextSubject) {
      toast.error("All faculty subjects are already in this quiz set.");
      return;
    }

    setQuizSet((current) => ({
      ...current,
      sections: [
        ...current.sections,
        createEmptySection(nextSubject.id, nextSubject.name),
      ],
    }));
  }

  function removeSection(sectionId: string) {
    if (locked) return;

    if (quizSet.sections.length <= 1) {
      toast.error("A quiz set needs at least one subject section.");
      return;
    }

    setQuizSet((current) => ({
      ...current,
      sections: current.sections.filter((section) => section.id !== sectionId),
    }));
  }

  function removeQuestion(sectionId: string, questionId: string) {
    updateSection(sectionId, (section) => ({
      ...section,
      questions: section.questions.filter(
        (question) => question.id !== questionId,
      ),
    }));
  }

  function changeSectionSubject(sectionId: string, subjectId: string) {
    const subject = facultySubjects.find((item) => item.id === subjectId);
    if (!subject) return;

    updateSection(sectionId, (section) => ({
      ...section,
      subjectId: subject.id,
      subjectName: subject.name,
    }));
  }

  function updateQuestion(
    sectionId: string,
    questionId: string,
    patch: Partial<QuestionDraft>,
  ) {
    updateSection(sectionId, (section) => ({
      ...section,
      questions: section.questions.map((question) =>
        question.id === questionId ? { ...question, ...patch } : question,
      ),
    }));
  }

  function updateOption(
    sectionId: string,
    questionId: string,
    optionId: string,
    patch: Partial<OptionDraft>,
  ) {
    updateSection(sectionId, (section) => ({
      ...section,
      questions: section.questions.map((question) => {
        if (question.id !== questionId) return question;

        const options = question.options.map((option) => {
          if (patch.isCorrect === true) {
            return {
              ...option,
              isCorrect: option.id === optionId,
              ...(option.id === optionId ? patch : {}),
            };
          }

          return option.id === optionId ? { ...option, ...patch } : option;
        });

        return { ...question, options };
      }),
    }));
  }

  function addQuestion(sectionId: string) {
    updateSection(sectionId, (section) => ({
      ...section,
      questions: [createEmptyQuestion(), ...section.questions],
    }));
  }

  function handlePublishToggle(nextPublished: boolean) {
    if (isPublishPending || quizSet.isPublished === nextPublished) {
      return;
    }

    const previousPublished = quizSet.isPublished;

    setQuizSet((current) => ({
      ...current,
      isPublished: nextPublished,
    }));
    setIsPublishPending(true);

    void (async () => {
      try {
        const result = await setQuizSetPublished({
          id: quizSet.id,
          isPublished: nextPublished,
        });

        if (!result.success) {
          setQuizSet((current) => ({
            ...current,
            isPublished: previousPublished,
          }));
          toast.error(result.message);
          return;
        }

        toast.success(
          result.message ??
            (nextPublished ? "Quiz set published." : "Quiz set unpublished."),
        );
        await invalidateQuizLists();
      } catch {
        setQuizSet((current) => ({
          ...current,
          isPublished: previousPublished,
        }));
        toast.error("Could not update publish state. Please try again.");
      } finally {
        setIsPublishPending(false);
      }
    })();
  }

  function handleFreeMockToggle(nextIsFreeMock: boolean) {
    if (isFreeMockPending || quizSet.isFreeMock === nextIsFreeMock) {
      return;
    }

    const previousIsFreeMock = quizSet.isFreeMock;

    setQuizSet((current) => ({
      ...current,
      isFreeMock: nextIsFreeMock,
    }));
    setIsFreeMockPending(true);

    void (async () => {
      try {
        const result = await setQuizSetFreeMock({
          id: quizSet.id,
          isFreeMock: nextIsFreeMock,
        });

        if (!result.success) {
          setQuizSet((current) => ({
            ...current,
            isFreeMock: previousIsFreeMock,
          }));
          toast.error(result.message);
          return;
        }

        toast.success(
          result.message ??
            (nextIsFreeMock
              ? "Marked as free mock."
              : "Free mock disabled."),
        );
        await invalidateQuizLists();
      } catch {
        setQuizSet((current) => ({
          ...current,
          isFreeMock: previousIsFreeMock,
        }));
        toast.error("Could not update free mock state. Please try again.");
      } finally {
        setIsFreeMockPending(false);
      }
    })();
  }

  function handleSave() {
    startTransition(async () => {
      const structureChanged =
        structureSignature(quizSet.sections) !== structureBaselineRef.current;

      if (locked || !structureChanged) {
        const parsed = updateQuizSetMetaSchema.safeParse({
          id: quizSet.id,
          title: quizSet.title,
          slug: quizSet.slug,
          description: quizSet.description,
          durationMinutes: quizSet.durationMinutes,
          isPublished: quizSet.isPublished,
          isFreeMock: quizSet.isFreeMock,
        });

        if (!parsed.success) {
          setFieldErrors(getZodFieldErrors<UpdateQuizSetMetaInput>(parsed.error));
          toast.error(parsed.error.issues[0]?.message ?? "Fix the form errors.");
          return;
        }

        setFieldErrors({});
        const result = await updateQuizSetMeta(parsed.data);

        if (!result.success) {
          if (result.errors) {
            setFieldErrors(result.errors);
          }
          toast.error(result.message);
          return;
        }

        toast.success(result.message ?? "Saved.");
        await invalidateQuizLists();
        return;
      }

      const parsed = updateQuizSetSchema.safeParse({
        id: quizSet.id,
        title: quizSet.title,
        slug: quizSet.slug,
        description: quizSet.description,
        durationMinutes: quizSet.durationMinutes,
        facultyId: quizSet.facultyId,
        isPublished: quizSet.isPublished,
        isFreeMock: quizSet.isFreeMock,
        sections: quizSet.sections.map((section) => ({
          id: isClientDraftId(section.id, "sec-") ? undefined : section.id,
          subjectId: section.subjectId,
          fullMarks: sectionMarksTotal(section.questions),
          questions: section.questions.map((question) => ({
            id: isClientDraftId(question.id, "q-") ? undefined : question.id,
            prompt: question.prompt,
            marks: question.marks,
            options: question.options.map((option) => ({
              label: option.label,
              isCorrect: option.isCorrect,
            })),
          })),
        })),
      });

      if (!parsed.success) {
        setFieldErrors(getZodFieldErrors<UpdateQuizSetInput>(parsed.error));
        toast.error(parsed.error.issues[0]?.message ?? "Fix the form errors.");
        return;
      }

      setFieldErrors({});
      const result = await updateQuizSet(parsed.data);

      if (!result.success) {
        if (result.errors) {
          setFieldErrors(result.errors);
        }
        toast.error(result.message);
        return;
      }

      const nextState: EditorState = {
        ...quizSet,
        sections: result.data.sections.map((section) => ({
          id: section.id,
          subjectId: section.subjectId,
          subjectName: section.subjectName,
          questions: section.questions.map((question) => ({
            id: question.id,
            prompt: question.prompt,
            marks: question.marks,
            options: question.options.map((option) => ({
              id: option.id,
              label: option.label,
              isCorrect: option.isCorrect,
            })),
          })),
        })),
      };

      setQuizSet(nextState);
      structureBaselineRef.current = structureSignature(nextState.sections);
      toast.success(result.message ?? "Saved.");
      await invalidateQuizLists();
    });
  }

  function openDeleteDialog() {
    if (locked) {
      toast.error(
        "Cannot delete a quiz set that already has participant attempts.",
      );
      return;
    }

    setDeleteDialogOpen(true);
  }

  function openCloneDialog() {
    const suffix = " (Free mock)";
    const nextTitle =
      quizSet.title.length + suffix.length <= 160
        ? `${quizSet.title}${suffix}`
        : `${quizSet.title.slice(0, Math.max(1, 160 - suffix.length)).trimEnd()}${suffix}`;
    const nextSlug = slugify(`${quizSet.slug}-free-mock`).slice(0, 160);

    setCloneTitle(nextTitle);
    setCloneSlug(nextSlug);
    setCloneSlugTouched(false);
    setCloneFieldErrors({});
    setCloneDialogOpen(true);
  }

  function confirmCloneAsFreeMock() {
    const parsed = cloneQuizSetAsFreeMockSchema.safeParse({
      sourceId: quizSet.id,
      title: cloneTitle,
      slug: cloneSlug,
    });

    if (!parsed.success) {
      setCloneFieldErrors(
        getZodFieldErrors<{ title: string; slug: string }>(parsed.error),
      );
      toast.error(parsed.error.issues[0]?.message ?? "Fix the form errors.");
      return;
    }

    setCloneFieldErrors({});

    startTransition(async () => {
      const result = await cloneQuizSetAsFreeMock(parsed.data);

      if (!result.success) {
        if (result.errors) {
          setCloneFieldErrors(result.errors);
        }
        toast.error(result.message);
        return;
      }

      toast.success(result.message ?? "Free mock duplicate created.");
      setCloneDialogOpen(false);
      await invalidateQuizLists();
      router.push(`/admin/quizzes/${result.data.id}`);
    });
  }

  function confirmDeleteQuizSet() {
    if (locked) return;

    setDeleteDialogOpen(false);

    startTransition(async () => {
      const result = await deleteQuizSet({ id: quizSet.id });

      if (!result.success) {
        toast.error(result.message);
        return;
      }

      toast.success(result.message ?? "Deleted.");
      await invalidateQuizLists();
      router.push("/admin/quizzes");
    });
  }

  return (
    <div className="space-y-8 pb-10">
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button asChild variant="ghost" size="sm" className="-ml-2">
            <Link href="/admin/quizzes">
              <ArrowLeft className="size-4" />
              Back
            </Link>
          </Button>
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link
                href={`/faculty/${quizSet.facultySlug}/${quizSet.slug}`}
                target="_blank"
              >
                Public page
                <ExternalLink className="size-4" />
              </Link>
            </Button>
            {!quizSet.isFreeMock ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isPending}
                onClick={openCloneDialog}
              >
                Duplicate as free mock
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isPending || locked}
              onClick={openDeleteDialog}
            >
              Delete
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleSave}
              disabled={isPending}
            >
              Save changes
            </Button>
          </div>
        </div>

        <Dialog open={cloneDialogOpen} onOpenChange={setCloneDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Duplicate as free mock</DialogTitle>
              <DialogDescription>
                Creates a new unpublished free-mock quiz set from the saved
                sections and questions on this set (unsaved edits are not
                included). The original set is unchanged. Access codes and
                attempts are not copied.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label htmlFor="clone-title">Title</Label>
                <Input
                  id="clone-title"
                  value={cloneTitle}
                  onChange={(event) => {
                    const nextTitle = event.target.value;
                    setCloneTitle(nextTitle);
                    setCloneFieldErrors((current) => ({
                      ...current,
                      title: undefined,
                    }));
                    if (!cloneSlugTouched) {
                      setCloneSlug(slugify(`${nextTitle}`));
                    }
                  }}
                  aria-invalid={Boolean(cloneFieldErrors.title)}
                />
                {cloneFieldErrors.title ? (
                  <p className="text-sm text-destructive">
                    {cloneFieldErrors.title}
                  </p>
                ) : null}
              </div>

              <div className="space-y-2">
                <Label htmlFor="clone-slug">Slug</Label>
                <Input
                  id="clone-slug"
                  value={cloneSlug}
                  onChange={(event) => {
                    setCloneSlugTouched(true);
                    setCloneSlug(slugify(event.target.value));
                    setCloneFieldErrors((current) => ({
                      ...current,
                      slug: undefined,
                    }));
                  }}
                  aria-invalid={Boolean(cloneFieldErrors.slug)}
                />
                {cloneFieldErrors.slug ? (
                  <p className="text-sm text-destructive">
                    {cloneFieldErrors.slug}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Must be unique within {quizSet.facultyName}.
                  </p>
                )}
              </div>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={isPending}
                onClick={() => setCloneDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                disabled={isPending}
                onClick={confirmCloneAsFreeMock}
              >
                {isPending ? "Creating…" : "Create free mock"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <ConfirmDeleteDialog
          open={deleteDialogOpen}
          onOpenChange={setDeleteDialogOpen}
          title="Delete quiz set?"
          description={`This will permanently delete “${quizSet.title}” and all of its sections, questions, and access codes. This cannot be undone.`}
          confirmLabel="Delete quiz set"
          requireTypedConfirm
          isPending={isPending}
          onConfirm={confirmDeleteQuizSet}
        />

        <ConfirmDeleteDialog
          open={Boolean(pendingSectionDelete)}
          onOpenChange={(open) => {
            if (!open) setPendingSectionDelete(null);
          }}
          title="Delete section?"
          description={
            pendingSectionDelete
              ? `Remove the “${pendingSectionDelete.name}” section and its questions from this quiz set? Save to apply.`
              : "Remove this section?"
          }
          confirmLabel="Delete section"
          onConfirm={() => {
            if (!pendingSectionDelete) return;
            removeSection(pendingSectionDelete.id);
            setPendingSectionDelete(null);
          }}
        />

        <ConfirmDeleteDialog
          open={Boolean(pendingQuestionDelete)}
          onOpenChange={(open) => {
            if (!open) setPendingQuestionDelete(null);
          }}
          title="Delete question?"
          description={
            pendingQuestionDelete
              ? `Remove ${pendingQuestionDelete.label}? Save to apply.`
              : "Remove this question?"
          }
          confirmLabel="Delete question"
          onConfirm={() => {
            if (!pendingQuestionDelete) return;
            removeQuestion(
              pendingQuestionDelete.sectionId,
              pendingQuestionDelete.questionId,
            );
            setPendingQuestionDelete(null);
          }}
        />

        {locked ? (
          <p className="border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-900 dark:text-amber-100">
            This quiz set already has attempts. You can update details and
            publish state, but questions and structure are locked.
          </p>
        ) : null}

        <section className="overflow-hidden border bg-card">
          <div className="border-b bg-muted/40 px-5 py-4">
            <h2 className="font-semibold tracking-tight">Quiz details</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {quizSet.facultyName}
            </p>
          </div>
          <div className="grid gap-4 p-5 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="edit-title">Title</Label>
              <Input
                id="edit-title"
                value={quizSet.title}
                aria-invalid={Boolean(fieldErrors.title)}
                onChange={(event) =>
                  setQuizSet((current) => ({
                    ...current,
                    title: event.target.value,
                    slug: locked
                      ? current.slug
                      : slugify(event.target.value),
                  }))
                }
              />
              {fieldErrors.title ? (
                <p className="text-sm text-destructive">{fieldErrors.title}</p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-slug">Slug</Label>
              <Input
                id="edit-slug"
                value={quizSet.slug}
                aria-invalid={Boolean(fieldErrors.slug)}
                onChange={(event) =>
                  setQuizSet((current) => ({
                    ...current,
                    slug: slugify(event.target.value),
                  }))
                }
              />
              {fieldErrors.slug ? (
                <p className="text-sm text-destructive">{fieldErrors.slug}</p>
              ) : null}
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="edit-description">Description</Label>
              <Textarea
                id="edit-description"
                value={quizSet.description}
                onChange={(event) =>
                  setQuizSet((current) => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
                rows={3}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-duration">Duration (minutes)</Label>
              <Input
                id="edit-duration"
                type="number"
                min={1}
                value={quizSet.durationMinutes}
                aria-invalid={Boolean(fieldErrors.durationMinutes)}
                onChange={(event) =>
                  setQuizSet((current) => ({
                    ...current,
                    durationMinutes: event.target.value,
                  }))
                }
              />
              {fieldErrors.durationMinutes ? (
                <p className="text-sm text-destructive">
                  {fieldErrors.durationMinutes}
                </p>
              ) : null}
            </div>
            <div className="flex items-center justify-between gap-3 border px-3 py-2.5">
              <div className="space-y-0.5">
                <Label htmlFor="edit-published">Published</Label>
                <p className="text-xs text-muted-foreground">
                  Visible on the faculty page when on.
                </p>
              </div>
              <Switch
                id="edit-published"
                checked={quizSet.isPublished}
                disabled={isPublishPending}
                onCheckedChange={handlePublishToggle}
              />
            </div>
            <div className="flex items-center justify-between gap-3 border px-3 py-2.5 md:col-span-2">
              <div className="space-y-0.5">
                <Label htmlFor="edit-free-mock">Free mock test</Label>
                <p className="text-xs text-muted-foreground">
                  Shared expiry code, timed attempt, name + public leaderboard.
                  After enabling, generate a shared code on the Codes page —
                  existing one-time codes stay one-time.
                </p>
              </div>
              <Switch
                id="edit-free-mock"
                checked={quizSet.isFreeMock}
                disabled={isFreeMockPending}
                onCheckedChange={handleFreeMockToggle}
              />
            </div>
          </div>
        </section>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">
            Subject sections
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {locked
              ? "Structure is locked because this quiz already has attempts."
              : "Add subjects, paste questions, or edit existing sections."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <QuizQuestionsPreviewTrigger
            quizTitle={quizSet.title.trim() || "Untitled quiz"}
            label="Preview quiz"
            sections={quizSet.sections.map((section) => ({
              id: section.id,
              subjectName: section.subjectName,
              questions: section.questions,
            }))}
          />
          {!locked ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addSection}
              disabled={
                !facultySubjects.some(
                  (subject) => !usedSubjectIds.has(subject.id),
                )
              }
            >
              <Plus className="size-4" />
              Add section
            </Button>
          ) : null}
        </div>
      </div>

      <div className="space-y-8">
        {quizSet.sections.map((section) => {
          const availableSubjects = facultySubjects.filter(
            (subject) =>
              subject.id === section.subjectId ||
              !usedSubjectIds.has(subject.id),
          );

          return (
          <section
            key={section.id}
            className="overflow-hidden border bg-card"
          >
            <div className="flex flex-wrap items-end justify-between gap-3 border-b bg-muted/40 px-5 py-4">
              <div className="flex min-w-0 flex-1 flex-wrap items-end gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center border bg-background text-sm font-semibold">
                  {section.subjectName.slice(0, 2).toUpperCase()}
                </span>
                {!locked ? (
                  <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">
                        Subject
                      </Label>
                      <Select
                        value={section.subjectId}
                        onValueChange={(value) =>
                          changeSectionSubject(section.id, value)
                        }
                      >
                        <SelectTrigger className="w-full bg-background">
                          <SelectValue placeholder="Select subject" />
                        </SelectTrigger>
                        <SelectContent>
                          {availableSubjects.map((subject) => (
                            <SelectItem key={subject.id} value={subject.id}>
                              {subject.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">
                        Full marks
                      </Label>
                      <div className="flex h-9 items-center rounded-md border bg-muted/40 px-3 text-sm">
                        {sectionMarksTotal(section.questions)}
                        <span className="ml-2 text-xs text-muted-foreground">
                          (from question marks)
                        </span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div>
                    <h2 className="font-semibold tracking-tight">
                      {section.subjectName}
                    </h2>
                    <p className="text-xs text-muted-foreground">
                      {sectionMarksTotal(section.questions)} marks ·{" "}
                      {section.questions.length} questions
                    </p>
                  </div>
                )}
              </div>
              {!locked ? (
                <div className="flex items-center gap-2">
                  <QuizQuestionsPreviewTrigger
                    label="Preview"
                    sections={[
                      {
                        id: section.id,
                        subjectName: section.subjectName,
                        questions: section.questions,
                      },
                    ]}
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => addQuestion(section.id)}
                  >
                    <Plus className="size-4" />
                    Add question
                  </Button>
                  {quizSet.sections.length > 1 ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      onClick={() =>
                        setPendingSectionDelete({
                          id: section.id,
                          name: section.subjectName,
                        })
                      }
                      aria-label={`Delete ${section.subjectName} section`}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  ) : null}
                </div>
              ) : (
                <QuizQuestionsPreviewTrigger
                  label="Preview"
                  sections={[
                    {
                      id: section.id,
                      subjectName: section.subjectName,
                      questions: section.questions,
                    },
                  ]}
                />
              )}
            </div>

            {!locked ? (
              <SectionQuestionsPastePanel
                sectionId={section.id}
                questionCount={section.questions.length}
                onApply={(questions, mode) =>
                  updateSection(section.id, (current) => ({
                    ...current,
                    questions:
                      mode === "append"
                        ? [...current.questions, ...questions]
                        : questions,
                  }))
                }
                onClearAll={() =>
                  updateSection(section.id, (current) => ({
                    ...current,
                    questions: [createEmptyQuestion()],
                  }))
                }
              />
            ) : null}

            <div
              className={cn(
                "grid gap-4 p-5 lg:grid-cols-2",
                section.questions.length > 6 && "max-h-216 overflow-y-auto",
              )}
            >
              {section.questions.map((question, questionIndex) => (
                <div
                  key={question.id}
                  className="group flex flex-col gap-4 border bg-background p-4"
                >
                  <div className="flex items-start gap-3">
                    <span className="mt-2.5 shrink-0 rounded-md bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">
                      Q{questionIndex + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <MathSourceField
                        multiline
                        rows={3}
                        value={question.prompt}
                        disabled={locked}
                        onChange={(prompt) =>
                          updateQuestion(section.id, question.id, { prompt })
                        }
                        placeholder="Question prompt"
                      />
                    </div>
                    {!locked && section.questions.length > 1 ? (
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="shrink-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        onClick={() =>
                          setPendingQuestionDelete({
                            sectionId: section.id,
                            questionId: question.id,
                            label: `question ${questionIndex + 1}`,
                          })
                        }
                        aria-label={`Delete question ${questionIndex + 1}`}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    ) : null}
                  </div>

                  <div className="space-y-1.5">
                    {question.options.map((option, optionIndex) => (
                      <div
                        key={option.id}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors",
                          locked && "opacity-70",
                          option.isCorrect
                            ? "border-foreground/30 bg-muted"
                            : "border-transparent hover:bg-muted/50",
                        )}
                      >
                        <button
                          type="button"
                          disabled={locked}
                          onClick={() =>
                            updateOption(section.id, question.id, option.id, {
                              isCorrect: true,
                            })
                          }
                          aria-label={`Mark option ${String.fromCharCode(65 + optionIndex)} as correct`}
                          className={cn(
                            "flex size-6 shrink-0 items-center justify-center rounded-md border text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-not-allowed",
                            option.isCorrect
                              ? "border-foreground bg-foreground text-background"
                              : "hover:bg-muted-foreground/10",
                          )}
                        >
                          {String.fromCharCode(65 + optionIndex)}
                        </button>
                        <div className="min-w-0 flex-1">
                          <MathSourceField
                            value={option.label}
                            disabled={locked}
                            onChange={(label) =>
                              updateOption(
                                section.id,
                                question.id,
                                option.id,
                                { label },
                              )
                            }
                            placeholder={`Option ${String.fromCharCode(65 + optionIndex)}`}
                            className="border-0 hover:bg-transparent focus-visible:ring-0"
                          />
                        </div>
                        {option.isCorrect ? (
                          <span className="shrink-0 text-xs font-medium text-muted-foreground">
                            Correct
                          </span>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
          );
        })}
      </div>
    </div>
  );
}
