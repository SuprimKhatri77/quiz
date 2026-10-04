export type ParsedQuestionOption = {
  label: string;
  isCorrect: boolean;
};

export type ParsedQuestion = {
  prompt: string;
  options: ParsedQuestionOption[];
};

export type ParsePastedQuestionsError = {
  questionIndex: number | null;
  message: string;
};

export type ParsePastedQuestionsResult = {
  questions: ParsedQuestion[];
  errors: ParsePastedQuestionsError[];
};

const QUESTION_START =
  /^(?:Q(?:uestion)?\s*\d*\s*[:.)-]\s*|\d+\s*[.)]\s+)/i;
const OPTION_LINE = /^([A-D])\s*[).:-]\s*(.+)$/i;
const CORRECT_LINE = /^(?:correct|answer)\s*[:.=-]?\s*([A-D])\s*$/i;
const CORRECT_MARKER = /(?:\*|✓|\(correct\)|\(answer\))\s*$/i;

export const PASTE_QUESTIONS_FORMAT_HELP = `1. Complete the analogy.

Book : Library :: Patient : ?
a. School
b. Hospital*
c. Office
d. Market

2. Choose the odd one out.
a. Rose
b. Lily
c. Lotus
d. Mango*

Q: What is the capital of France?
A) London
B) Berlin
C) Paris *
D) Madrid

Math (LaTeX) is supported and rendered for students:
Q: $(\\int \\frac{dx}{x^2-1})$ is equal to:
A) $(\\frac{1}{2}\\log|\\frac{x-1}{x+1}|+C)$
B) $(\\frac{1}{2}\\log|\\frac{x+1}{x-1}|+C)$ *
C) $(\\log|x^2-1|+C)$
D) $(-\\frac{1}{2}\\log|\\frac{x-1}{x+1}|+C)$`;

function newId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

function isCorrectMarker(raw: string) {
  return CORRECT_MARKER.test(raw);
}

function stripCorrectMarker(raw: string) {
  return raw.replace(CORRECT_MARKER, "").trim();
}

/**
 * Prepare pasted math for KaTeX rendering.
 * Keeps LaTeX commands, fixes common ChatGPT/OCR artifacts, and wraps
 * parenthesized LaTeX (and pure-math lines) in `$...$` delimiters.
 */
export function normalizeMathPaste(text: string): string {
  let result = text.replace(/[\u200B-\u200D\uFEFF]/g, "");

  // Digits duplicated around frac (OCR / copy artifact) → real LaTeX
  // e.g. "12\frac{1}{2}21" → "\frac{1}{2}"
  result = result.replace(
    /(\d+)(\d+)\\frac\{\1\}\{\2\}\2\1/g,
    "\\frac{$1}{$2}",
  );

  // Shorthand \frac12 → \frac{1}{2}
  result = result.replace(/\\frac(\d)(\d)/g, "\\frac{$1}{$2}");

  // ChatGPT often uses commas instead of \, before dx
  result = result.replace(/,\s*(?=dx\b)/gi, "\\,");

  // Normalize \(...\) / \[...\] to $ / $$
  result = result.replace(/\\\(([\s\S]+?)\\\)/g, (_match, inner: string) => {
    return `$${inner}$`;
  });
  result = result.replace(/\\\[([\s\S]+?)\\\]/g, (_match, inner: string) => {
    return `$$${inner}$$`;
  });

  let insideDisplayMath = false;
  return result
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      const displayDelimiters = (trimmed.match(/\$\$/g) ?? []).length;

      const next = insideDisplayMath
        ? trimmed
        : wrapLatexForKatex(trimmed);

      if (displayDelimiters % 2 === 1) {
        insideDisplayMath = !insideDisplayMath;
      }

      return next;
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function looksLikeLatex(value: string) {
  return /\\[a-zA-Z]+/.test(value);
}

/** True when, after stripping LaTeX commands/groups, no prose words remain. */
function looksLikePureMath(value: string) {
  const stripped = value.replace(/\\[a-zA-Z]+(\{[^{}]*\})*/g, "");
  return !/[a-zA-Z]{3,}/.test(stripped);
}

/**
 * Wrap `(...latex...)` chunks and whole-line math in `$...$`.
 * Leaves already-delimited math alone.
 */
function wrapLatexForKatex(line: string): string {
  if (!line || line.includes("$")) {
    return line;
  }

  if (!looksLikeLatex(line)) {
    return line.replace(/\s{2,}/g, " ");
  }

  let result = "";
  let index = 0;
  let wrappedAny = false;

  while (index < line.length) {
    if (line[index] !== "(") {
      result += line[index];
      index += 1;
      continue;
    }

    let depth = 0;
    let end = -1;
    for (let cursor = index; cursor < line.length; cursor += 1) {
      const char = line[cursor];
      if (char === "(") depth += 1;
      if (char === ")") {
        depth -= 1;
        if (depth === 0) {
          end = cursor;
          break;
        }
      }
    }

    if (end === -1) {
      result += line.slice(index);
      break;
    }

    const inner = line.slice(index + 1, end).trim();
    if (looksLikeLatex(inner)) {
      result += `$${inner}$`;
      wrappedAny = true;
    } else {
      result += line.slice(index, end + 1);
    }
    index = end + 1;
  }

  const trimmed = result.replace(/\s{2,}/g, " ").trim();

  // Pure math option/line with no parentheses wrapper
  if (!wrappedAny && looksLikePureMath(trimmed) && !trimmed.includes("$")) {
    return `$${trimmed}$`;
  }

  return trimmed;
}

/**
 * Parse bulk-pasted MCQ text into question drafts.
 *
 * Supported shapes:
 *   1. Instruction line
 *
 *   Stem / analogy line
 *   a. option
 *   b. option*
 *   c. option
 *   d. option
 *
 *   Q: prompt
 *   A) option
 *   B) option *
 *   C) option
 *   D) option
 *
 * Exactly 4 options (A–D). Mark the correct option with `*` (or ✓ / (correct)).
 * Optionally end a block with `Correct: C`.
 * Extra prompt lines (before options) are kept as separate lines in the prompt.
 */
export function parsePastedQuestions(raw: string): ParsePastedQuestionsResult {
  const lines = raw
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const questions: ParsedQuestion[] = [];
  const errors: ParsePastedQuestionsError[] = [];

  type Draft = {
    sourceIndex: number;
    prompt: string;
    options: Array<{ letter: string; label: string; isCorrect: boolean }>;
    correctLetter: string | null;
  };

  let current: Draft | null = null;
  let nextSourceIndex = 1;

  function flush() {
    if (!current) return;

    const questionIndex = current.sourceIndex;
    const prompt = normalizeMathPaste(current.prompt);

    if (!prompt) {
      errors.push({
        questionIndex,
        message: `Question ${questionIndex} is missing a prompt.`,
      });
      current = null;
      return;
    }

    if (current.options.length !== 4) {
      errors.push({
        questionIndex,
        message: `Question ${questionIndex} must have exactly 4 options (A–D). Found ${current.options.length}.`,
      });
      current = null;
      return;
    }

    const letters = current.options.map((option) => option.letter);
    if (letters.join("") !== "ABCD") {
      errors.push({
        questionIndex,
        message: `Question ${questionIndex} options must be A, B, C, D in order.`,
      });
      current = null;
      return;
    }

    let options = current.options.map((option) => ({
      label: normalizeMathPaste(option.label),
      isCorrect: option.isCorrect,
    }));

    if (current.correctLetter) {
      options = options.map((option, index) => ({
        ...option,
        isCorrect:
          String.fromCharCode(65 + index) === current!.correctLetter,
      }));
    }

    const correctCount = options.filter((option) => option.isCorrect).length;
    if (correctCount !== 1) {
      errors.push({
        questionIndex,
        message:
          correctCount === 0
            ? `Question ${questionIndex} needs a correct answer (mark with * or add Correct: A).`
            : `Question ${questionIndex} has ${correctCount} correct answers; mark exactly one.`,
      });
      current = null;
      return;
    }

    for (const [index, option] of options.entries()) {
      if (!option.label.trim()) {
        errors.push({
          questionIndex,
          message: `Question ${questionIndex} option ${String.fromCharCode(65 + index)} is empty.`,
        });
        current = null;
        return;
      }
    }

    questions.push({ prompt, options });
    current = null;
  }

  for (const line of lines) {
    const correctMatch = line.match(CORRECT_LINE);
    if (correctMatch && current) {
      current.correctLetter = correctMatch[1]!.toUpperCase();
      continue;
    }

    const optionMatch = line.match(OPTION_LINE);
    if (optionMatch && current) {
      const letter = optionMatch[1]!.toUpperCase();
      const rawLabel = optionMatch[2] ?? "";
      const marked = isCorrectMarker(rawLabel);
      current.options.push({
        letter,
        label: stripCorrectMarker(rawLabel),
        isCorrect: marked,
      });
      continue;
    }

    if (QUESTION_START.test(line) || !current) {
      flush();
      current = {
        sourceIndex: nextSourceIndex,
        prompt: line.replace(QUESTION_START, "").trim() || line,
        options: [],
        correctLetter: null,
      };
      nextSourceIndex += 1;
      continue;
    }

    // Continuation of the prompt (multi-line question text).
    if (current.options.length === 0) {
      current.prompt = `${current.prompt}\n${line}`.trim();
      continue;
    }

    errors.push({
      questionIndex: current.sourceIndex,
      message: `Unexpected line in question ${current.sourceIndex}: "${line}"`,
    });
  }

  flush();

  if (questions.length === 0 && errors.length === 0) {
    errors.push({
      questionIndex: null,
      message: "No questions found. Paste text using the format shown below.",
    });
  }

  return { questions, errors };
}

export function parsedQuestionsToDrafts(
  questions: ParsedQuestion[],
): Array<{
  id: string;
  prompt: string;
  marks: number;
  timeLimitSeconds: number | null;
  options: Array<{ id: string; label: string; isCorrect: boolean }>;
}> {
  return questions.map((question) => ({
    id: newId("q"),
    prompt: question.prompt,
    marks: 1,
    timeLimitSeconds: null,
    options: question.options.map((option, index) => ({
      id: newId(`opt-${index + 1}`),
      label: option.label,
      isCorrect: option.isCorrect,
    })),
  }));
}
