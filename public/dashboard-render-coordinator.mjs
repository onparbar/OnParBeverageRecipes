const DEFAULT_MAX_FLUSH_PASSES = 100;

export function createDashboardRenderCoordinator({
  maxFlushPasses = DEFAULT_MAX_FLUSH_PASSES,
  onError = null,
} = {}) {
  const pending = new Map();
  const stats = {
    requested: 0,
    deferred: 0,
    deduplicated: 0,
    rendered: 0,
    flushes: 0,
  };
  let batchDepth = 0;
  let flushing = false;
  let activeKey = "";
  const remainingKeys = new Set();

  function defer(key, render) {
    const normalizedKey = String(key ?? "").trim();
    if (!normalizedKey) throw new TypeError("A render key is required.");
    if (typeof render !== "function") throw new TypeError(`Render ${normalizedKey} must be a function.`);

    stats.requested += 1;
    if (flushing && activeKey === normalizedKey) return false;
    if (flushing && remainingKeys.has(normalizedKey)) {
      stats.deferred += 1;
      stats.deduplicated += 1;
      return true;
    }
    if (!batchDepth && !flushing) return false;

    stats.deferred += 1;
    if (pending.has(normalizedKey)) stats.deduplicated += 1;
    pending.set(normalizedKey, render);
    return true;
  }

  function flush() {
    if (batchDepth || flushing || !pending.size) return 0;

    const errors = [];
    let passCount = 0;
    let renderedCount = 0;
    flushing = true;
    stats.flushes += 1;

    try {
      while (pending.size) {
        passCount += 1;
        if (passCount > maxFlushPasses) {
          pending.clear();
          errors.push({
            key: "render-cycle",
            error: new Error(`Dashboard rendering exceeded ${maxFlushPasses} coordinated passes.`),
          });
          break;
        }

        const pass = [...pending.entries()];
        pending.clear();
        remainingKeys.clear();
        pass.forEach(([key]) => remainingKeys.add(key));
        pass.forEach(([key, render]) => {
          remainingKeys.delete(key);
          activeKey = key;
          try {
            render();
            stats.rendered += 1;
            renderedCount += 1;
          } catch (error) {
            errors.push({ key, error });
          } finally {
            activeKey = "";
          }
        });
      }
    } finally {
      activeKey = "";
      remainingKeys.clear();
      flushing = false;
    }

    if (errors.length) {
      if (typeof onError === "function") {
        errors.forEach(({ key, error }) => onError(error, key));
      } else {
        throw new AggregateError(
          errors.map(({ error }) => error),
          `Dashboard rendering failed for ${errors.map(({ key }) => key).join(", ")}.`,
        );
      }
    }
    return renderedCount;
  }

  async function batch(task) {
    if (typeof task !== "function") throw new TypeError("A render batch task is required.");
    batchDepth += 1;
    try {
      return await task();
    } finally {
      batchDepth -= 1;
      if (!batchDepth) flush();
    }
  }

  function getStats() {
    return {
      ...stats,
      pending: pending.size,
      batchDepth,
      flushing,
    };
  }

  return {
    batch,
    defer,
    flush,
    getStats,
  };
}
