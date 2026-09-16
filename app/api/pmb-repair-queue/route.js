import { NextResponse } from "next/server";
import { requireDashboardRequestRole } from "../../../lib/dashboard-auth.mjs";
import { createBackupStore } from "../../../lib/dashboard-backup-store.mjs";
import { getPmbRepairClock, readPmbMorningRepairStatus } from "../../../lib/pmb-morning-repair.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };

export async function GET(request) {
  try {
    await requireDashboardRequestRole(request, { owner: true });
    const store = createBackupStore();
    const catalog = await store.read("pmb-product-catalog");
    const assignments = await store.rest("pmb_tap_product_current", { select: "data,observed_at", limit: 250 });
    const status = await readPmbMorningRepairStatus();
    if (!catalog?.data?.products?.length || !assignments.length) {
      throw new Error("Repair queue data is unavailable.");
    }
    const now = new Date();
    let nextRunAt = null;
    if (status.enabled) {
      for (let minute = 1; minute <= 2880; minute += 1) {
        const candidate = new Date(now.getTime() + minute * 60000);
        const local = getPmbRepairClock(candidate);
        const weekday = new Date(`${local.date}T12:00:00Z`).getUTCDay();
        if (status.schedules.some((slot) => slot.hour === local.hour
          && (slot.minute || 0) === local.minute
          && (slot.weekday === undefined || slot.weekday === weekday))) {
          candidate.setUTCSeconds(0, 0);
          nextRunAt = candidate.toISOString();
          break;
        }
      }
    }
    const recent = (value) => Number.isFinite(Date.parse(value))
      && now.getTime() - Date.parse(value) < 45 * 60000;
    const lastRun = status.lastRun;
    const activated = lastRun?.productPreparation?.result?.activated || [];
    const items = assignments.flatMap(({ data: tap, observed_at: observedAt }) => {
      const matches = catalog.data.products.filter((product) => Number(product.plu) === Number(tap.plu));
      if (matches.length !== 1) return [];
      const product = matches[0];
      const inactive = [0, "0", false].includes(product.is_active);
      const awaitingVerification = activated.some((entry) => Number(entry.plu) === Number(tap.plu))
        && lastRun.status !== "verified";
      if (!inactive && !awaitingVerification) return [];
      return [{ tapNumber: tap.tapNumber, name: tap.name, plu: tap.plu,
        state: awaitingVerification ? "awaiting-verification" : status.enabled ? "queued" : "paused",
        fresh: recent(observedAt) && recent(catalog.captured_at),
      }];
    });
    return NextResponse.json({ items, nextRunAt, checkedAt: catalog.captured_at,
      statusUnavailable: Boolean(status.statusError),
    }, { headers });
  } catch (error) {
    return NextResponse.json({ error: "Automatic tap repair status is unavailable." }, {
      status: Number(error.status) || 503, headers,
    });
  }
}
