import { createHash } from 'node:crypto';

const PREFIX = 'pmb-product-name-';
const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const key = value => clean(value).normalize('NFKC').replace(/’/g, "'").toLowerCase();
const validPlu = value => Number.isSafeInteger(Number(value)) && Number(value) > 0;
export function isKnownProductName(value) {
  const name = clean(value);
  return Boolean(name && name.length <= 250 && !/[<>]/.test(name)
    && !/^(?:(?:product\s*)?plu\s*#?\s*\d+|unknown(?: product)?|unnamed(?: product)?|deleted(?: product)?|coming soon!?|unused|null|undefined|name unavailable.*)$/i.test(name));
}
export function productNameRecords(items, { source = 'pmb', observedAt = new Date().toISOString() } = {}) {
  if (!Array.isArray(items) || !/^[a-z0-9-]{1,80}$/.test(source) || !Number.isFinite(Date.parse(observedAt))) throw new Error('Invalid product-name evidence.');
  const unique = new Map();
  for (const item of items) {
    const candidate = item?.name || item?.product;
    if (typeof candidate !== 'string') continue;
    const name = clean(candidate);
    if (!validPlu(item?.plu) || !isKnownProductName(name)) continue;
    const plu = Number(item.plu);
    const digest = createHash('sha256').update(`${plu}\n${key(name)}\n${source}`).digest('hex').slice(0,24);
    const id = `${PREFIX}${plu}-${digest}`;
    unique.set(id, {source:id, data:{schemaVersion:1,plu,name,evidenceSource:source,observedAt:new Date(observedAt).toISOString()},captured_at:new Date(observedAt).toISOString(),updated_at:new Date(observedAt).toISOString()});
  }
  return [...unique.values()];
}
function configuration(env) {
  const base = clean(env.SUPABASE_URL).replace(/\/+$/,'');
  const secret = clean(env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY);
  if (!base || !secret) throw new Error('Product-name history storage is not configured.');
  return {base, headers:{apikey:secret,...(secret.split('.').length===3?{Authorization:`Bearer ${secret}`}:{}) ,'Content-Type':'application/json'}};
}
async function rest(query, options, {env=process.env,fetchImpl=globalThis.fetch}={}) {
  const {base,headers}=configuration(env);
  const response=await fetchImpl(`${base}/rest/v1/pmb_data_backup?${query}`,{...options,headers:{...headers,...options?.headers},cache:'no-store',signal:AbortSignal.timeout(10000)});
  const result=await response.json().catch(()=>null);
  if (!response.ok || !Array.isArray(result)) throw new Error(`Product-name history storage failed (${response.status}).`);
  return result;
}
// One immutable row per exact PLU/name/source. Concurrent refreshes cannot replace
// a previous name, and missing/retired PMB products never delete these records.
export async function rememberProductNames(items, options={}) {
  const records=productNameRecords(items,options);
  let inserted=0;
  for(let offset=0;offset<records.length;offset+=250) {
    const saved=await rest('on_conflict=source',{method:'POST',headers:{Prefer:'resolution=ignore-duplicates,return=representation'},body:JSON.stringify(records.slice(offset,offset+250))},options);
    inserted+=saved.length;
  }
  return {observed:records.length,inserted};
}
export async function readProductNames(options={}) {
  const records=[];
  for(let offset=0;offset<20000;offset+=500) {
    const rows=await rest(`select=data&source=like.${PREFIX}*&order=source&limit=500&offset=${offset}`,{method:'GET'},options);
    records.push(...rows.map(r=>r.data).filter(r=>r?.schemaVersion===1 && validPlu(r.plu) && isKnownProductName(r.name)));
    if(rows.length<500)return records;
  }
  throw new Error('Product-name history exceeds the safe read limit.');
}

const forwardSeen = new Set();
const forwardRunning = new Set();
// Capture only the current named products supplied by the caller. A failure is
// isolated from the dashboard request and retried on a subsequent observation.
export async function captureProductNamesBestEffort(items, options = {}) {
  const source = options.source || 'weekly-usage-forward';
  let claimed = false;
  try {
    if (forwardRunning.has(source)) return { saved: false, skipped: 'in-progress' };
    forwardRunning.add(source); claimed = true;
    const records = productNameRecords(items, { ...options, source }).filter(r => !forwardSeen.has(r.source));
    if (!records.length) return { saved: true, observed: 0 };
    const save = options.saveImpl || rememberProductNames;
    const result = await save(records.map(r => ({ plu:r.data.plu, name:r.data.name })), { ...options, source });
    if (forwardSeen.size > 20000) forwardSeen.clear();
    records.forEach(r => forwardSeen.add(r.source));
    return { saved: true, ...result };
  } catch {
    try { (options.warn || console.warn)('PMB_NAME_CAPTURE_UNAVAILABLE: reporting continues; a later observation will retry.'); } catch { /* Logging must not interrupt reporting either. */ }
    return { saved:false, code:'PMB_NAME_CAPTURE_UNAVAILABLE' };
  } finally {
    if (claimed) forwardRunning.delete(source);
  }
}
