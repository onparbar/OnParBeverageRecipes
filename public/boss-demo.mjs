export const BOSS_DEMO_STEPS = Object.freeze([
  Object.freeze({ id: "refresh", label: "Refresh PMB", title: "Start with one trusted pull" }),
  Object.freeze({ id: "count", label: "Voice count", title: "Count the coolers naturally" }),
  Object.freeze({ id: "plan", label: "Smart plan", title: "Turn counts into one weekly plan" }),
  Object.freeze({ id: "orders", label: "Vendor carts", title: "Review every vendor handoff" }),
  Object.freeze({ id: "receiving", label: "Receiving", title: "Record deliveries and exceptions" }),
  Object.freeze({ id: "prep", label: "Staff prep", title: "Complete cocktails and liquor refills" }),
  Object.freeze({ id: "complete", label: "Complete", title: "See what is left at a glance" }),
]);

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function integer(value) {
  return Math.max(0, Math.round(number(value)));
}

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(number(value));
}

function money(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(number(value));
}

export function normalizeBossDemoStep(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return 0;
  return Math.min(BOSS_DEMO_STEPS.length - 1, Math.max(0, parsed));
}

export function buildBossDemoModel({
  step = 0,
  planLocked = false,
  planDate = "",
  pmbTapCount = 0,
  summary = {},
  vendors = [],
} = {}) {
  const stepIndex = normalizeBossDemoStep(step);
  const currentStep = BOSS_DEMO_STEPS[stepIndex];
  const vendorSummaries = (vendors || []).map((vendor) => ({
    name: clean(vendor.vendor),
    lineCount: integer(vendor.lineCount ?? vendor.lines?.length),
    estimatedTotal: number(vendor.estimatedTotal),
  })).filter((vendor) => vendor.name);
  return {
    stepIndex,
    stepNumber: stepIndex + 1,
    stepCount: BOSS_DEMO_STEPS.length,
    currentStep,
    previousStep: stepIndex > 0 ? stepIndex - 1 : null,
    nextStep: stepIndex < BOSS_DEMO_STEPS.length - 1 ? stepIndex + 1 : null,
    planLocked: planLocked === true,
    planDate: clean(planDate),
    pmbTapCount: integer(pmbTapCount),
    metrics: {
      orderLines: integer(summary.orderLineCount),
      beerKegs: number(summary.beerKegTotal),
      cocktailBatches: number(summary.cocktailBatchTotal),
      liquorBottles: number(summary.liquorTapBottleTotal),
      purchaseEstimate: number(summary.estimatedKnownPurchaseCost),
    },
    vendors: vendorSummaries,
    sampleVoiceCount: {
      transcript: "Main cooler: three Michelob Ultra, three Miller Lite, one Coors Light, one Garage Beer Lime, and add another Truth.",
      matches: [
        ["Michelob Ultra", 3],
        ["Miller Lite", 3],
        ["Coors Light", 1],
        ["Garage Beer Lime", 1],
        ["Truth", "+1"],
      ],
    },
  };
}

function staffDemoHref(section, stepIndex) {
  return `/staff?rehearsal=1&demo=1&section=${encodeURIComponent(section)}&demoStep=${normalizeBossDemoStep(stepIndex)}`;
}

function renderMetrics(model) {
  const metrics = [
    ["Order lines", formatNumber(model.metrics.orderLines)],
    ["Beer kegs", formatNumber(model.metrics.beerKegs)],
    ["Cocktail batches", formatNumber(model.metrics.cocktailBatches)],
    ["Liquor bottles", formatNumber(model.metrics.liquorBottles)],
    ["Purchase estimate", money(model.metrics.purchaseEstimate)],
  ];
  return `<div class="boss-demo-metrics">${metrics.map(([label, value]) => `<article><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></article>`).join("")}</div>`;
}

function renderStage(model, orderWorkspace) {
  switch (model.currentStep.id) {
    case "refresh":
      return `
        <div class="boss-demo-signal-grid">
          <article><span>Keg levels</span><strong>${model.pmbTapCount ? `${formatNumber(model.pmbTapCount)} taps` : "Ready"}</strong></article>
          <article><span>Weekly usage</span><strong>Included</strong></article>
          <article><span>Tap pricing</span><strong>Included</strong></article>
        </div>
        <p class="boss-demo-note">The real <strong>Refresh PMB</strong> action gathers all three. This demonstration uses the latest saved, verified snapshot and does not contact PMB.</p>
      `;
    case "count":
      return `
        <div class="boss-demo-voice">
          <span>Example cooler count</span>
          <blockquote>${escapeHtml(model.sampleVoiceCount.transcript)}</blockquote>
          <div>${model.sampleVoiceCount.matches.map(([name, quantity]) => `<span><strong>${escapeHtml(quantity)}</strong> ${escapeHtml(name)}</span>`).join("")}</div>
        </div>
        <p class="boss-demo-note">Location context, product aliases, corrections, and “add another” language are resolved before anything is applied.</p>
      `;
    case "plan":
      return `
        ${renderMetrics(model)}
        <p class="boss-demo-note">The same calculation model powers the live dashboard, the locked plan, vendor drafts, and staff assignments.</p>
      `;
    case "orders":
      return `
        <div class="boss-demo-vendors">${model.vendors.map((vendor) => `<span><strong>${escapeHtml(vendor.name)}</strong>${formatNumber(vendor.lineCount)} items · ${money(vendor.estimatedTotal)}</span>`).join("") || "<span>No vendor drafts are in the saved plan.</span>"}</div>
        <p class="boss-demo-note">Cart actions remain review-only. Rehearsal never checks out or submits an order.</p>
        ${orderWorkspace || ""}
      `;
    case "receiving":
      return `
        <div class="boss-demo-handoff">
          <div><span>Staff handoff</span><strong>Deliveries begin unchecked</strong><p>Demonstrate full receipts, shortages, rejected items, over-deliveries, notes, and speech review.</p></div>
          <a class="primary-button" href="${staffDemoHref("orders", model.stepIndex)}" target="_blank" rel="noopener">Open receiving demo</a>
        </div>
        <p class="boss-demo-note">The staff demo updates only its in-memory copy. Reloading resets every delivery.</p>
      `;
    case "prep":
      return `
        <div class="boss-demo-handoff-grid">
          <a href="${staffDemoHref("prep", model.stepIndex)}" target="_blank" rel="noopener"><span>Cocktails to make</span><strong>${formatNumber(model.metrics.cocktailBatches)} batches</strong><small>Open staff demo</small></a>
          <a href="${staffDemoHref("liquor", model.stepIndex)}" target="_blank" rel="noopener"><span>Liquor to add</span><strong>${formatNumber(model.metrics.liquorBottles)} bottles</strong><small>Open staff demo</small></a>
        </div>
        <p class="boss-demo-note">Staff can select several items, enter their name once, and save together. Demo completions never subtract live inventory.</p>
      `;
    default:
      return `
        <div class="boss-demo-finish">
          <span>Demo complete</span>
          <strong>One plan. One clear handoff. No live changes.</strong>
          <p>The dashboard connects Monday data, counting, ordering, receiving, cocktail prep, liquor refills, and completion status without requiring staff to understand the underlying systems.</p>
        </div>
        ${renderMetrics(model)}
      `;
  }
}

export function renderBossDemo(model, { orderWorkspace = "" } = {}) {
  const progress = Math.round((model.stepNumber / model.stepCount) * 100);
  return `
    <section class="boss-demo" aria-labelledby="boss-demo-title">
      <header class="boss-demo__header">
        <div><p class="eyebrow">Read-only rehearsal</p><h2 id="boss-demo-title">Rehearsal</h2></div>
        <span class="boss-demo__safe">No live records change</span>
      </header>
      <div class="boss-demo__progress" role="progressbar" aria-valuemin="1" aria-valuemax="${model.stepCount}" aria-valuenow="${model.stepNumber}" aria-label="Boss demo progress"><i style="width:${progress}%"></i></div>
      <nav class="boss-demo__steps" aria-label="Boss demo steps">
        ${BOSS_DEMO_STEPS.map((step, index) => `<button type="button" data-boss-demo-step="${index}" class="${index < model.stepIndex ? "is-complete" : index === model.stepIndex ? "is-current" : ""}"${index === model.stepIndex ? ' aria-current="step"' : ""}><b>${index + 1}</b><span>${escapeHtml(step.label)}</span></button>`).join("")}
      </nav>
      <article class="boss-demo__stage">
        <div class="boss-demo__stage-title"><span>Step ${model.stepNumber} of ${model.stepCount}</span><h3>${escapeHtml(model.currentStep.title)}</h3></div>
        ${model.planLocked ? renderStage(model, orderWorkspace) : '<p class="boss-demo-note boss-demo-note--warning">A locked Weekly Plan is required before this demo can use real plan totals.</p>'}
      </article>
      <footer class="boss-demo__actions">
        <button class="ghost-button" type="button" data-boss-demo-reset>Reset demo</button>
        <span></span>
        ${model.previousStep === null ? "" : `<button class="ghost-button" type="button" data-boss-demo-step="${model.previousStep}">Back</button>`}
        ${model.nextStep === null ? `<button class="primary-button" type="button" data-boss-demo-step="0">Run again</button>` : `<button class="primary-button" type="button" data-boss-demo-step="${model.nextStep}">Next: ${escapeHtml(BOSS_DEMO_STEPS[model.nextStep].label)}</button>`}
      </footer>
    </section>
  `;
}

function cloneOrderTracking(source = {}) {
  return {
    ...source,
    vendors: (source.vendors || []).map((vendor) => ({
      ...vendor,
      items: (vendor.items || []).map((item) => ({ ...item })),
    })),
  };
}

function summarizeOrderTracking(source = {}) {
  const items = (source.vendors || []).flatMap((vendor) => vendor.items || []);
  return {
    ...source,
    itemCount: items.length,
    receivedCount: items.filter((item) => ["received", "extra"].includes(clean(item.status))).length,
    notReceivedCount: items.filter((item) => ["partial", "not-received", "rejected"].includes(clean(item.status))).length,
  };
}

export function buildRehearsalOrderTracking(source = {}) {
  const rehearsal = cloneOrderTracking(source);
  rehearsal.rehearsal = true;
  rehearsal.vendors = rehearsal.vendors.map((vendor) => ({
    ...vendor,
    deliveryNote: "",
    items: vendor.items.map((item) => ({
      ...item,
      status: "pending",
      receivedQuantity: 0,
      handledBy: "",
      updatedAt: "",
      reason: "",
    })),
  }));
  return summarizeOrderTracking(rehearsal);
}

export function applyRehearsalReceipts(source = {}, {
  vendorId = "",
  receipts = [],
  handledBy = "Rehearsal",
  note = "",
  updatedAt = new Date().toISOString(),
} = {}) {
  const next = cloneOrderTracking(source);
  const receiptById = new Map((receipts || []).map((receipt) => [clean(receipt.itemId), receipt]));
  next.vendors = next.vendors.map((vendor) => {
    const vendorMatches = !clean(vendorId) || clean(vendor.id) === clean(vendorId);
    let touched = false;
    const items = vendor.items.map((item) => {
      const receipt = vendorMatches ? receiptById.get(clean(item.id)) : null;
      if (!receipt) return item;
      touched = true;
      const receivedQuantity = integer(receipt.receivedQuantity);
      const requestedQuantity = integer(item.quantity);
      const requestedStatus = clean(receipt.status);
      const status = ["received", "partial", "not-received", "rejected", "extra"].includes(requestedStatus)
        ? requestedStatus
        : receivedQuantity > requestedQuantity ? "extra"
          : receivedQuantity >= requestedQuantity ? "received"
            : receivedQuantity > 0 ? "partial" : "not-received";
      return {
        ...item,
        status,
        receivedQuantity,
        handledBy: clean(handledBy),
        updatedAt,
        reason: clean(receipt.reason),
      };
    });
    return {
      ...vendor,
      items,
      deliveryNote: touched && clean(note)
        ? [clean(vendor.deliveryNote), clean(note)].filter(Boolean).join("; ")
        : vendor.deliveryNote,
    };
  });
  next.rehearsal = true;
  return summarizeOrderTracking(next);
}
