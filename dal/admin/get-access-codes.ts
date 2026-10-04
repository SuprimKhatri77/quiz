import {
  and,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  or,
  sql,
  type SQL,
} from "drizzle-orm";

import { db } from "@/db";
import {
  accessCodes,
  attemptLeaveEvents,
  quizAttempts,
  quizSets,
} from "@/db/schema";
import { requireAdminForDal } from "@/dal/admin/require-admin";
import { ADMIN_PAGE_SIZE } from "@/modules/admin/constants";

export type AccessCodeStatus =
  | "available"
  | "issued"
  | "used"
  | "expired"
  | "revoked";

export type CancelledAttemptLeaveEvent = {
  id: string;
  occurredAt: string;
  reason: string;
  durationMs: number | null;
  countsAsStrike: boolean;
  forgiven: boolean;
};

/** A lockdown-cancelled attempt on a one-time code (void until an admin reopens it). */
export type CancelledAttemptInfo = {
  attemptId: string;
  cancelledAt: string;
  reason: string | null;
  events: CancelledAttemptLeaveEvent[];
};

export type AccessCodeListItem = {
  id: string;
  code: string;
  quizSetId: string;
  quizSetTitle: string;
  status: AccessCodeStatus;
  isIssued: boolean;
  isUsed: boolean;
  isRevoked: boolean;
  isShared: boolean;
  hasAttempt: boolean;
  attemptCount: number;
  cancelledAttempt: CancelledAttemptInfo | null;
  issuedAt: string | null;
  usedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
};

export type AccessCodeListResult = {
  items: AccessCodeListItem[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
};

function resolveStatus(
  isRevoked: boolean,
  isUsed: boolean,
  isIssued: boolean,
  isShared: boolean,
  expiresAt: Date | null,
  now: Date,
): AccessCodeStatus {
  if (isRevoked) {
    return "revoked";
  }

  if (!isShared && isUsed) {
    return "used";
  }

  if (expiresAt && expiresAt < now) {
    return "expired";
  }

  if (isIssued) {
    return "issued";
  }

  return "available";
}

function toDateString(value: Date | null) {
  return value ? value.toISOString().slice(0, 10) : null;
}

function notExpiredFilter(now: Date): SQL {
  return or(isNull(accessCodes.expiresAt), gte(accessCodes.expiresAt, now))!;
}

export async function getAccessCodes({
  q = "",
  status = "all",
  quizSetId,
  page = 1,
  pageSize = ADMIN_PAGE_SIZE,
}: {
  q?: string;
  status?: "all" | AccessCodeStatus;
  quizSetId?: string;
  page?: number;
  pageSize?: number;
} = {}): Promise<AccessCodeListResult> {
  await requireAdminForDal();

  const safePageSize = Math.min(Math.max(1, pageSize), 100);
  const query = q.trim();
  const now = new Date();
  const filters: SQL[] = [];

  if (query) {
    filters.push(ilike(accessCodes.code, `%${query}%`));
  }

  if (quizSetId && quizSetId !== "all") {
    filters.push(eq(accessCodes.quizSetId, quizSetId));
  }

  if (status === "revoked") {
    filters.push(eq(accessCodes.isRevoked, true));
  } else if (status === "used") {
    filters.push(
      and(eq(accessCodes.isRevoked, false), eq(accessCodes.isUsed, true))!,
    );
  } else if (status === "available") {
    filters.push(
      and(
        eq(accessCodes.isRevoked, false),
        eq(accessCodes.isUsed, false),
        eq(accessCodes.isIssued, false),
        notExpiredFilter(now),
      )!,
    );
  } else if (status === "issued") {
    filters.push(
      and(
        eq(accessCodes.isRevoked, false),
        eq(accessCodes.isUsed, false),
        eq(accessCodes.isIssued, true),
        notExpiredFilter(now),
      )!,
    );
  } else if (status === "expired") {
    filters.push(
      and(
        eq(accessCodes.isRevoked, false),
        eq(accessCodes.isUsed, false),
        isNotNull(accessCodes.expiresAt),
        lt(accessCodes.expiresAt, now),
      )!,
    );
  }

  const where = filters.length > 0 ? and(...filters) : undefined;

  const totalRow = await db
    .select({ value: count() })
    .from(accessCodes)
    .where(where);

  const total = Number(totalRow[0]?.value ?? 0);
  const pageCount = Math.max(1, Math.ceil(total / safePageSize));
  const safePage = Math.min(Math.max(1, page), pageCount);

  const attemptCountExpr = sql<number>`(
    select count(*)::int from ${quizAttempts}
    where ${quizAttempts.accessCodeId} = ${accessCodes.id}
  )`;

  const rows = await db
    .select({
      id: accessCodes.id,
      code: accessCodes.code,
      quizSetId: accessCodes.quizSetId,
      quizSetTitle: quizSets.title,
      isIssued: accessCodes.isIssued,
      isUsed: accessCodes.isUsed,
      isRevoked: accessCodes.isRevoked,
      isShared: accessCodes.isShared,
      issuedAt: accessCodes.issuedAt,
      usedAt: accessCodes.usedAt,
      expiresAt: accessCodes.expiresAt,
      createdAt: accessCodes.createdAt,
      attemptCount: attemptCountExpr,
    })
    .from(accessCodes)
    .innerJoin(quizSets, eq(accessCodes.quizSetId, quizSets.id))
    .where(where)
    .orderBy(desc(accessCodes.createdAt), desc(accessCodes.id))
    .limit(safePageSize)
    .offset((safePage - 1) * safePageSize);

  const oneTimeCodeIds = rows.filter((row) => !row.isShared).map((row) => row.id);
  const cancelledByCodeId = new Map<string, CancelledAttemptInfo>();

  if (oneTimeCodeIds.length > 0) {
    const cancelledAttempts = await db
      .select({
        id: quizAttempts.id,
        accessCodeId: quizAttempts.accessCodeId,
        cancelledAt: quizAttempts.cancelledAt,
        cancelReason: quizAttempts.cancelReason,
      })
      .from(quizAttempts)
      .where(
        and(
          inArray(quizAttempts.accessCodeId, oneTimeCodeIds),
          eq(quizAttempts.status, "cancelled"),
        ),
      );

    const events =
      cancelledAttempts.length > 0
        ? await db
            .select()
            .from(attemptLeaveEvents)
            .where(
              inArray(
                attemptLeaveEvents.attemptId,
                cancelledAttempts.map((attempt) => attempt.id),
              ),
            )
            .orderBy(attemptLeaveEvents.occurredAt)
        : [];

    for (const attempt of cancelledAttempts) {
      cancelledByCodeId.set(attempt.accessCodeId, {
        attemptId: attempt.id,
        cancelledAt: toDateString(attempt.cancelledAt) ?? "",
        reason: attempt.cancelReason,
        events: events
          .filter((event) => event.attemptId === attempt.id)
          .map((event) => ({
            id: event.id,
            occurredAt: event.occurredAt.toISOString(),
            reason: event.reason,
            durationMs: event.durationMs,
            countsAsStrike: event.countsAsStrike,
            forgiven: event.forgivenAt !== null,
          })),
      });
    }
  }

  return {
    items: rows.map((row) => {
      const attemptCount = Number(row.attemptCount ?? 0);
      return {
        id: row.id,
        code: row.code,
        quizSetId: row.quizSetId,
        quizSetTitle: row.quizSetTitle,
        status: resolveStatus(
          row.isRevoked,
          row.isUsed,
          row.isIssued,
          row.isShared,
          row.expiresAt,
          now,
        ),
        isIssued: row.isIssued,
        isUsed: row.isUsed,
        isRevoked: row.isRevoked,
        isShared: row.isShared,
        hasAttempt: attemptCount > 0,
        attemptCount,
        cancelledAttempt: cancelledByCodeId.get(row.id) ?? null,
        issuedAt: toDateString(row.issuedAt),
        usedAt: toDateString(row.usedAt),
        expiresAt: toDateString(row.expiresAt),
        createdAt: toDateString(row.createdAt) ?? "",
      };
    }),
    total,
    page: safePage,
    pageSize: safePageSize,
    pageCount,
  };
}
