// Pending reports are independent records: acknowledging one tab's save must
// never remove another tab's work. No report-size data is written to localStorage.
export function createWeeklyUsageJournal({ indexedDB = globalThis.indexedDB, name = "onpar-weekly-usage", timeoutMs = 10000 } = {}) {
  let connection;
  let writes = Promise.resolve();
  const superseded = new Set();
  const open = () => {
    if (connection) return connection;
    connection = new Promise((resolve, reject) => {
      if (!indexedDB) { reject(new Error("Browser recovery storage is unavailable.")); return; }
      let settled = false;
      const finish = (error, db) => {
        if (settled) { db?.close(); return; }
        settled = true;
        clearTimeout(timer);
        if (error) reject(error); else resolve(db);
      };
      const timer = setTimeout(() => finish(new Error("Browser recovery storage timed out.")), timeoutMs);
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => request.result.createObjectStore("pending", { keyPath: "id" });
      request.onerror = () => finish(request.error);
      request.onblocked = () => finish(new Error("Browser recovery storage is busy in another tab."));
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => { db.close(); connection = null; };
        finish(null, db);
      };
    }).catch(error => { connection = null; throw error; });
    return connection;
  };
  const transact = async (mode, action) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction("pending", mode);
      const result = action(transaction.objectStore("pending"));
      const timer = setTimeout(() => {
        try { transaction.abort(); } catch { /* Already finished. */ }
        reject(new Error("Browser recovery transaction timed out."));
      }, timeoutMs);
      transaction.oncomplete = () => { clearTimeout(timer); resolve(result?.result); };
      transaction.onabort = transaction.onerror = () => {
        clearTimeout(timer);
        reject(transaction.error || new Error("Browser recovery transaction failed."));
      };
    });
  };
  const enqueue = action => {
    const result = writes.catch(() => {}).then(action);
    writes = result;
    return result;
  };
  return {
    async list() {
      await writes.catch(() => {});
      return transact("readonly", store => store.getAll());
    },
    put(entry, previousId = "") {
      const copy = structuredClone(entry);
      return enqueue(async () => {
        if (previousId && previousId !== copy.id) superseded.add(previousId);
        const retired = [...superseded].filter(id => id !== copy.id);
        await transact("readwrite", store => {
          store.put(copy);
          retired.forEach(id => store.delete(id));
        });
        retired.forEach(id => superseded.delete(id));
      });
    },
    remove(id) {
      return enqueue(async () => {
        const retired = [...superseded];
        await transact("readwrite", store => {
          store.delete(id);
          retired.forEach(previous => store.delete(previous));
        });
        retired.forEach(previous => superseded.delete(previous));
      });
    },
  };
}
