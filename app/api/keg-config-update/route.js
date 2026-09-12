import { NextResponse } from "next/server";
import { requireDashboardRequestRole } from "../../../lib/dashboard-auth.mjs";
import { recordDashboardActivity } from "../../../lib/dashboard-activity-log.mjs";
import { sendFullPmbConfigUpdate } from "../../../lib/pmb-full-config-update.mjs";

export async function POST(request) {
  let role = "";
  try {
    role = await requireDashboardRequestRole(request, { owner: true });
    const body = await request.json().catch(() => ({}));
    if (body?.acknowledgeTapInterruption !== true) {
      return NextResponse.json(
        { error: "Confirm that all guest tap walls are clear before sending a configuration update." },
        { status: 409 },
      );
    }
    const result = await sendFullPmbConfigUpdate();
    recordDashboardActivity({
      area: "Keg Levels",
      action: "sent PMB config update",
      role,
      summary: "Sent a full tap-wall configuration update after guest-clear confirmation.",
    }).catch(() => {});
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (role) {
      recordDashboardActivity({
        area: "Keg Levels",
        action: "PMB config update failed",
        role,
        summary: `No successful full-wall configuration update was confirmed. ${String(error?.message || "PMB error").slice(0, 120)}.`,
      }).catch(() => {});
    }
    return NextResponse.json(
      { error: error.message || "Could not send config update." },
      { status: Number(error?.status) || 500 },
    );
  }
}
