"use server";

import {
  actionFailure,
  actionSuccess,
  zodErrorMap,
  type ActionResult,
} from "@/lib/action-result";
import { recordLeave, type RecordLeaveResult } from "@/lib/record-leave";
import {
  reportLeaveSchema,
  type ReportLeaveInput,
} from "@/modules/quiz/schemas/attempt";

export async function reportLeave(
  input: ReportLeaveInput,
): Promise<ActionResult<RecordLeaveResult>> {
  const parsed = reportLeaveSchema.safeParse(input);

  if (!parsed.success) {
    return actionFailure("Invalid leave report.", zodErrorMap(parsed.error));
  }

  const result = await recordLeave(parsed.data.attemptId, {
    reason: parsed.data.reason,
    durationMs: parsed.data.durationMs,
  });

  if (!result) {
    return actionFailure("Attempt not found.");
  }

  return actionSuccess(result);
}
