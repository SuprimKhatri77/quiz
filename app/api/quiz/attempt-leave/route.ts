import { recordLeave } from "@/lib/record-leave";

/**
 * Unload beacon: navigator.sendBeacon posts here when the exam page is closed,
 * refreshed or navigated away from. The attempt id is the capability (same as
 * the student server actions); the server decides if it is a strike.
 */
export async function POST(request: Request) {
  // Browsers set Sec-Fetch-Site; refuse cross-site posts (same-origin beacons only).
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") {
    return new Response(null, { status: 403 });
  }

  let attemptId: unknown;

  try {
    // sendBeacon sends text/plain or a Blob; accept both as JSON text.
    const text = await request.text();
    if (text.length > 1024) {
      return new Response(null, { status: 413 });
    }
    const body = JSON.parse(text) as { attemptId?: unknown };
    attemptId = body.attemptId;
  } catch {
    return new Response(null, { status: 400 });
  }

  if (typeof attemptId !== "string" || attemptId.length === 0) {
    return new Response(null, { status: 400 });
  }

  const result = await recordLeave(attemptId, {
    reason: "unload",
    durationMs: null,
  });

  return result ? new Response(null, { status: 204 }) : new Response(null, { status: 404 });
}
