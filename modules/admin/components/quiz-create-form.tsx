"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { createQuizSet } from "@/actions/admin/quizzes/create";
import { MathSourceField } from "@/components/math-text";
import { Button } from "@/components/ui/button";
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
import type { FacultyOption } from "@/dal/admin/get-faculties";
import type { SubjectOption } from "@/dal/admin/get-quiz-set";
import { getZodFieldErrors } from "@/lib/action-result";
import { cn } from "@/lib/utils";
import { derivedDurationMinutes } from "@/lib/question-timer";
import {
  DurationField,
  QuestionTimeField,
  SectionTimeShortcut,
} from "@/modules/admin/components/question-time-controls";
import { slugify } from "@/lib/slugify";
import { SectionQuestionsPastePanel } from "@/modules/admin/components/section-questions-paste-panel";
import { ConfirmDeleteDialog } from "@/modules/admin/components/confirm-delete-dialog";
import { QuizQuestionsPreviewTrigger } from "@/modules/admin/components/quiz-questions-preview";
import { adminKeys } from "@/modules/admin/hooks/queries/keys";
import {
  createQuizSetSchema,
  type CreateQuizSetInput,
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
  timeLimitSeconds: number | null;
  options: OptionDraft[];
};

type SectionDraft = {
  id: string;
  subjectId: string;
  questions: QuestionDraft[];
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
    timeLimitSeconds: null,
    options: createEmptyOptions(),
  };
}

function createEmptySection(subjectId = ""): SectionDraft {
  return {
    id: `sec-${Math.random().toString(36).slice(2, 9)}`,
    subjectId,
    questions: [createEmptyQuestion()],
  };
}

export function QuizCreateForm({
  faculties,
  subjects,
}: {
  faculties: FacultyOption[];
  subjects: SubjectOption[];
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [isPending, startTransition] = useTransition();
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [durationMinutes, setDurationMinutes] = useState("120");
  const [isPublished, setIsPublished] = useState(false);
  const [isFreeMock, setIsFreeMock] = useState(false);
  const [facultyId, setFacultyId] = useState(faculties[0]?.id ?? "");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [pendingSectionDelete, setPendingSectionDelete] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [pendingQuestionDelete, setPendingQuestionDelete] = useState<{
    sectionId: string;
    questionId: string;
    label: string;
  } | null>(null);
  const [sections, setSections] = useState<SectionDraft[]>([
    createEmptySection(
      subjects.find((subject) => subject.facultyId === faculties[0]?.id)?.id ??
        "",
    ),
  ]);

  const derivedMinutes = useMemo(
    () =>
      derivedDurationMinutes(
        sections.flatMap((section) =>
          section.questions.map((question) => question.timeLimitSeconds),
        ),
      ),
    [sections],
  );

  const facultySubjects = useMemo(
    () => subjects.filter((subject) => subject.facultyId === facultyId),
    [facultyId, subjects],
  );

  const subjectNameById = useMemo(
    () =>
      Object.fromEntries(
        facultySubjects.map((subject) => [subject.id, subject.name]),
      ),
    [facultySubjects],
  );

  function updateSection(sectionId: string, patch: Partial<SectionDraft>) {
    setSections((current) =>
      current.map((section) =>
        section.id === sectionId ? { ...section, ...patch } : section,
      ),
    );
  }

  function updateQuestion(
    sectionId: string,
    questionId: string,
    patch: Partial<QuestionDraft>,
  ) {
    setSections((current) =>
      current.map((section) =>
        section.id !== sectionId
          ? section
          : {
              ...section,
              questions: section.questions.map((question) =>
                question.id === questionId
                  ? { ...question, ...patch }
                  : question,
              ),
            },
      ),
    );
  }

  function updateOption(
    sectionId: string,
    questionId: string,
    optionId: string,
    patch: Partial<OptionDraft>,
  ) {
    setSections((current) =>
      current.map((section) =>
        section.id !== sectionId
          ? section
          : {
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

                  return option.id === optionId
                    ? { ...option, ...patch }
                    : option;
                });

                return { ...question, options };
              }),
            },
      ),
    );
  }

  function handleFacultyChange(nextFacultyId: string) {
    setFacultyId(nextFacultyId);
    const firstSubject =
      subjects.find((subject) => subject.facultyId === nextFacultyId)?.id ?? "";
    setSections([createEmptySection(firstSubject)]);
  }

  function handleSubmit() {
    const payload = {
      title,
      slug,
      description,
      // Ignored server-side when every question is timed (derived instead).
      durationMinutes: derivedMinutes === null ? durationMinutes : undefined,
      facultyId,
      isPublished,
      isFreeMock,
      sections: sections.map((section) => {
        const fullMarks = section.questions.reduce(
          (sum, question) => sum + question.marks,
          0,
        );

        return {
          subjectId: section.subjectId,
          fullMarks,
          questions: section.questions.map((question) => ({
            prompt: question.prompt,
            marks: question.marks,
            timeLimitSeconds: question.timeLimitSeconds,
            options: question.options.map((option) => ({
              label: option.label,
              isCorrect: option.isCorrect,
            })),
          })),
        };
      }),
    };

    const parsed = createQuizSetSchema.safeParse(payload);

    if (!parsed.success) {
      setFieldErrors(
        getZodFieldErrors<CreateQuizSetInput>(
          parsed.error,
        ) as Record<string, string>,
      );
      toast.error(parsed.error.issues[0]?.message ?? "Fix the form errors.");
      return;
    }

    setFieldErrors({});

    startTransition(async () => {
      const result = await createQuizSet(parsed.data);

      if (!result.success) {
        if (result.errors) {
          setFieldErrors(result.errors);
        }
        toast.error(result.message);
        return;
      }

      toast.success(result.message ?? "Quiz set created.");
      await queryClient.invalidateQueries({
        queryKey: adminKeys.quizSetsRoot(),
      });
      router.push("/admin/quizzes");
    });
  }

  return (
    <div className="space-y-8 pb-10">
      <ConfirmDeleteDialog
        open={Boolean(pendingSectionDelete)}
        onOpenChange={(open) => {
          if (!open) setPendingSectionDelete(null);
        }}
        title="Delete section?"
        description={
          pendingSectionDelete
            ? `Remove the “${pendingSectionDelete.name}” section and its questions?`
            : "Remove this section?"
        }
        confirmLabel="Delete section"
        onConfirm={() => {
          if (!pendingSectionDelete) return;
          setSections((current) =>
            current.filter((item) => item.id !== pendingSectionDelete.id),
          );
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
            ? `Remove ${pendingQuestionDelete.label}?`
            : "Remove this question?"
        }
        confirmLabel="Delete question"
        onConfirm={() => {
          if (!pendingQuestionDelete) return;
          const { sectionId, questionId } = pendingQuestionDelete;
          setSections((current) =>
            current.map((section) =>
              section.id !== sectionId
                ? section
                : {
                    ...section,
                    questions: section.questions.filter(
                      (question) => question.id !== questionId,
                    ),
                  },
            ),
          );
          setPendingQuestionDelete(null);
        }}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href="/admin/quizzes">
            <ArrowLeft className="size-4" />
            Back
          </Link>
        </Button>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/admin/quizzes">Cancel</Link>
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={handleSubmit}
            disabled={isPending || faculties.length === 0}
          >
            Create quiz set
          </Button>
        </div>
      </div>

      <div className="space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
          New quiz set
        </h1>
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
          Set faculty and details first, then add subject sections with their
          own marks and questions.
        </p>
      </div>

      <section className="overflow-hidden border bg-card">
        <div className="border-b bg-muted/40 px-5 py-4">
          <h2 className="font-semibold tracking-tight">Quiz details</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            These show on the faculty page and public quiz set route.
          </p>
        </div>
        <div className="grid gap-4 p-5 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="quiz-title">Title</Label>
            <Input
              id="quiz-title"
              value={title}
              onChange={(event) => {
                const next = event.target.value;
                setTitle(next);
                setSlug(slugify(next));
              }}
              placeholder="Entrance Assessment 2026"
            />
            {fieldErrors.title ? (
              <p className="text-sm text-destructive">{fieldErrors.title}</p>
            ) : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="quiz-slug">Slug</Label>
            <Input
              id="quiz-slug"
              value={slug}
              onChange={(event) => setSlug(slugify(event.target.value))}
              placeholder="entrance-2026"
            />
            {fieldErrors.slug ? (
              <p className="text-sm text-destructive">{fieldErrors.slug}</p>
            ) : null}
          </div>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="quiz-description">Description</Label>
            <Textarea
              id="quiz-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={3}
              placeholder="Short description for participants"
            />
          </div>
          <div className="space-y-2">
            <Label>Faculty</Label>
            <Select value={facultyId} onValueChange={handleFacultyChange}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select faculty" />
              </SelectTrigger>
              <SelectContent>
                {faculties.map((faculty) => (
                  <SelectItem key={faculty.id} value={faculty.id}>
                    {faculty.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {fieldErrors.facultyId ? (
              <p className="text-sm text-destructive">{fieldErrors.facultyId}</p>
            ) : null}
          </div>
          <DurationField
            id="quiz-duration"
            value={durationMinutes}
            onChange={setDurationMinutes}
            derivedMinutes={derivedMinutes}
            error={fieldErrors.durationMinutes}
          />
          <div className="flex items-center justify-between gap-3 border px-3 py-2.5 md:col-span-2">
            <div className="space-y-0.5">
              <Label htmlFor="quiz-published">Publish immediately</Label>
              <p className="text-xs text-muted-foreground">
                Make this quiz visible on the faculty page after create.
              </p>
            </div>
            <Switch
              id="quiz-published"
              checked={isPublished}
              onCheckedChange={setIsPublished}
            />
          </div>
          <div className="flex items-center justify-between gap-3 border px-3 py-2.5 md:col-span-2">
            <div className="space-y-0.5">
              <Label htmlFor="quiz-free-mock">Free mock test</Label>
              <p className="text-xs text-muted-foreground">
                Shared expiry code, timed attempt, name + public leaderboard.
                Generate a shared code on the Codes page after creating the quiz.
              </p>
            </div>
            <Switch
              id="quiz-free-mock"
              checked={isFreeMock}
              onCheckedChange={setIsFreeMock}
            />
          </div>
        </div>
      </section>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">
            Subject sections
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Example: English 50, Maths 40, Science 45, GK 30
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <QuizQuestionsPreviewTrigger
            quizTitle={title.trim() || "Untitled quiz"}
            label="Preview quiz"
            sections={sections.map((section) => ({
              id: section.id,
              subjectName:
                subjectNameById[section.subjectId] ?? "Subject section",
              questions: section.questions,
            }))}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              setSections((current) => [
                ...current,
                createEmptySection(facultySubjects[0]?.id ?? ""),
              ])
            }
          >
            <Plus className="size-4" />
            Add section
          </Button>
        </div>
      </div>

      <div className="space-y-8">
        {sections.map((section) => {
          const subjectName =
            subjectNameById[section.subjectId] ?? "Subject section";

          return (
            <section
              key={section.id}
              className="overflow-hidden border bg-card"
            >
              <div className="flex flex-wrap items-end justify-between gap-3 border-b bg-muted/40 px-5 py-4">
                <div className="flex min-w-0 flex-1 flex-wrap items-end gap-3">
                  <span className="flex size-10 shrink-0 items-center justify-center border bg-background text-sm font-semibold">
                    {subjectName.slice(0, 2).toUpperCase()}
                  </span>
                  <div className="grid min-w-0 flex-1 gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">
                        Subject
                      </Label>
                      <Select
                        value={section.subjectId}
                        onValueChange={(value) =>
                          updateSection(section.id, { subjectId: value })
                        }
                      >
                        <SelectTrigger className="w-full bg-background">
                          <SelectValue placeholder="Select subject" />
                        </SelectTrigger>
                        <SelectContent>
                          {facultySubjects.map((subject) => (
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
                        {section.questions.reduce(
                          (sum, question) => sum + question.marks,
                          0,
                        )}
                        <span className="ml-2 text-xs text-muted-foreground">
                          (from question marks)
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <QuizQuestionsPreviewTrigger
                    label="Preview"
                    sections={[
                      {
                        id: section.id,
                        subjectName,
                        questions: section.questions,
                      },
                    ]}
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      updateSection(section.id, {
                        questions: [
                          createEmptyQuestion(),
                          ...section.questions,
                        ],
                      })
                    }
                  >
                    <Plus className="size-4" />
                    Add question
                  </Button>
                  {sections.length > 1 ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      onClick={() =>
                        setPendingSectionDelete({
                          id: section.id,
                          name: subjectName,
                        })
                      }
                      aria-label="Delete section"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  ) : null}
                </div>
              </div>

              <SectionTimeShortcut
                onApply={(seconds) =>
                  updateSection(section.id, {
                    questions: section.questions.map((question) => ({
                      ...question,
                      timeLimitSeconds: seconds,
                    })),
                  })
                }
              />

              <SectionQuestionsPastePanel
                sectionId={section.id}
                questionCount={section.questions.length}
                onApply={(questions, mode) =>
                  setSections((current) =>
                    current.map((item) =>
                      item.id !== section.id
                        ? item
                        : {
                            ...item,
                            questions:
                              mode === "append"
                                ? [...item.questions, ...questions]
                                : questions,
                          },
                    ),
                  )
                }
                onClearAll={() =>
                  updateSection(section.id, {
                    questions: [createEmptyQuestion()],
                  })
                }
              />

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
                          onChange={(prompt) =>
                            updateQuestion(section.id, question.id, { prompt })
                          }
                          placeholder="Question prompt"
                        />
                      </div>
                      {section.questions.length > 1 ? (
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

                    <QuestionTimeField
                      id={`time-${question.id}`}
                      value={question.timeLimitSeconds}
                      onChange={(timeLimitSeconds) =>
                        updateQuestion(section.id, question.id, {
                          timeLimitSeconds,
                        })
                      }
                    />

                    <div className="space-y-1.5">
                      {question.options.map((option, optionIndex) => (
                        <div
                          key={option.id}
                          className={cn(
                            "flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors",
                            option.isCorrect
                              ? "border-foreground/30 bg-muted"
                              : "border-transparent hover:bg-muted/50",
                          )}
                        >
                          <button
                            type="button"
                            onClick={() =>
                              updateOption(section.id, question.id, option.id, {
                                isCorrect: true,
                              })
                            }
                            aria-label={`Mark option ${String.fromCharCode(65 + optionIndex)} as correct`}
                            className={cn(
                              "flex size-6 shrink-0 items-center justify-center rounded-md border text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
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
