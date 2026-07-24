import { NextResponse } from "next/server";
import { readParAgentState, runParAgentUpdate, syncParAgentState } from "../../../lib/par-agent.mjs";

export const runtime = "nodejs";

async function getBody(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

export async function GET() {
  try {
    const state = await readParAgentState();
    return NextResponse.json(state);
  } catch (error) {
    return NextResponse.json(
      { error: error.message || "Could not load par agent state." },
      { status: 500 },
    );
  }
}

export async function POST(request) {
  try {
    const body = await getBody(request);
    const action = String(body.action || "sync-state");
    const patch = {
      onHandOverrides: body.onHandOverrides,
      parOverrides: body.parOverrides,
      onDeckOverrides: body.onDeckOverrides,
      settings: body.settings,
    };

    if (action === "run") {
      const state = await runParAgentUpdate({
        dryRun: Boolean(body.dryRun),
        patch,
      });
      return NextResponse.json(state);
    }

    const state = await syncParAgentState(patch);
    return NextResponse.json(state);
  } catch (error) {
    return NextResponse.json(
      { error: error.message || "Could not update par agent state." },
      { status: 500 },
    );
  }
}
