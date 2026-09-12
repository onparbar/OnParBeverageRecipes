import { NextResponse } from "next/server";
import { requireDashboardRequestRole } from "../../../lib/dashboard-auth.mjs";
import { answerWithLocalAi, getLocalAiConfiguration } from "../../../lib/local-dashboard-ai.mjs";

export const runtime = "nodejs";
const respond = (body, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

async function readLimitedBody(request) {
  const max = 4 * 1024 * 1024;
  if (Number(request.headers.get("content-length")) > max) throw Object.assign(new Error("Dashboard snapshot is too large."), { status: 413 });
  const reader = request.body?.getReader();
  if (!reader) throw Object.assign(new Error("Request body is required."), { status: 400 });
  const decoder = new TextDecoder();
  let size = 0, text = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) { await reader.cancel(); throw Object.assign(new Error("Dashboard snapshot is too large."), { status: 413 }); }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    try { return JSON.parse(text); } catch { throw Object.assign(new Error("Invalid question request."), { status: 400 }); }
  } finally { reader.releaseLock(); }
}

export async function GET(request) {
  try {
    await requireDashboardRequestRole(request, { owner: true });
    return respond({ ...getLocalAiConfiguration(), local: true });
  } catch (error) { return respond({ error: "Owner login is required." }, error.status || 401); }
}

export async function POST(request) {
  try {
    await requireDashboardRequestRole(request, { owner: true });
    const origin = request.headers.get("origin");
    if (!origin || new URL(origin).host !== request.headers.get("host")
      || !request.headers.get("content-type")?.startsWith("application/json")) {
      return respond({ error: "Submit questions from the dashboard." }, 403);
    }
    return respond(await answerWithLocalAi(await readLimitedBody(request), { signal: request.signal }));
  } catch (error) {
    return respond({ error: error.status ? error.message : "The local AI is unavailable. The regular dashboard search still works." }, error.status || 503);
  }
}
