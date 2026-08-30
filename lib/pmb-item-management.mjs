import crypto from "node:crypto";
import http from "node:http";
import https from "node:https";

import {
  PmbPortionPriceUpdateError,
  normalizePmbPortionItem,
  verifyPmbPortionFormTargets,
} from "./pmb-portion-price-update.mjs";

const REQUEST_TIMEOUT_MS = 15_000;
const SUCCESS_CACHE_MS = 10 * 60_000;
const FAILURE_CACHE_MS = 30_000;
const capabilityCache = new Map();

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalize(value) {
  return clean(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’']/g, "")
    .toLowerCase();
}

function fail(message, code = "PMB_PORTION_FORM_UNVERIFIED", status = 503, details = {}) {
  throw new PmbPortionPriceUpdateError(message, { code, status, details });
}

function decodeHtml(value) {
  return String(value ?? "")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&quot;/gi, "\"")
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&");
}

function stripHtml(value) {
  return clean(decodeHtml(String(value || "").replace(/<[^>]+>/g, " ")));
}

function parseAttributes(tag) {
  const attributes = {};
  const source = String(tag || "").replace(/^<\/?[a-z0-9:-]+\s*/i, "").replace(/\/?\s*>$/, "");
  const pattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let match;
  while ((match = pattern.exec(source))) {
    attributes[match[1].toLowerCase()] = decodeHtml(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return attributes;
}

function safePath(value, fallback = "/pages/items") {
  const url = new URL(clean(value) || fallback, "http://pmb.local");
  if (!url.pathname.startsWith("/pages/")) return "";
  return `${url.pathname}${url.search}`;
}

function selectedValues(control, attributes) {
  const options = [...String(control || "").matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/gi)]
    .map((match) => {
      const attrs = parseAttributes(`<option ${match[1]}>`);
      return {
        value: attrs.value ?? stripHtml(match[2]),
        selected: Object.hasOwn(attrs, "selected"),
        disabled: Object.hasOwn(attrs, "disabled"),
      };
    })
    .filter((option) => !option.disabled);
  const selected = options.filter((option) => option.selected);
  if (Object.hasOwn(attributes, "multiple")) return selected.map((option) => option.value);
  return [(selected[0] || options[0])?.value].filter((value) => value != null);
}

function parseControls(inner) {
  const elements = String(inner || "").match(/<input\b[^>]*>|<textarea\b[^>]*>[\s\S]*?<\/textarea>|<select\b[^>]*>[\s\S]*?<\/select>|<button\b[^>]*>[\s\S]*?<\/button>/gi) || [];
  const controls = [];
  elements.forEach((element, controlIndex) => {
    const opening = element.match(/^<[^>]+>/)?.[0] || element;
    const attributes = parseAttributes(opening);
    const name = clean(attributes.name);
    if (!name || Object.hasOwn(attributes, "disabled")) return;
    const isButton = /^<button\b/i.test(element);
    const isInput = /^<input\b/i.test(element);
    const type = clean(attributes.type || (isButton ? "submit" : "text")).toLowerCase();
    if (isInput && ["checkbox", "radio"].includes(type) && !Object.hasOwn(attributes, "checked")) return;
    const text = isButton ? stripHtml(element.replace(/^<button\b[^>]*>/i, "").replace(/<\/button>$/i, "")) : "";
    const submit = ["submit", "button", "image"].includes(type) || isButton;
    let values = [attributes.value ?? (isInput && ["checkbox", "radio"].includes(type) ? "on" : "")];
    if (/^<textarea\b/i.test(element)) {
      values = [decodeHtml(element.replace(/^<textarea\b[^>]*>/i, "").replace(/<\/textarea>$/i, ""))];
    } else if (/^<select\b/i.test(element)) {
      values = selectedValues(element, attributes);
    }
    values.forEach((value, valueIndex) => controls.push({
      name,
      value: String(value ?? ""),
      type,
      text,
      submit,
      controlIndex,
      valueIndex,
    }));
  });
  return controls;
}

function parseForms(html) {
  return [...String(html || "").matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)]
    .map((match, index) => {
      const attributes = parseAttributes(`<form ${match[1]}>`);
      const action = safePath(attributes.action || "/pages/items");
      if (!action) return null;
      return {
        index,
        html: match[0],
        inner: match[2],
        action,
        method: clean(attributes.method || "get").toLowerCase(),
        enctype: clean(attributes.enctype || "application/x-www-form-urlencoded").toLowerCase(),
        controls: parseControls(match[2]),
      };
    })
    .filter(Boolean);
}

function requestEntries(form, clicked) {
  return form.controls
    .filter((control) => !control.submit || control === clicked)
    .map((control) => ({ ...control }));
}

function findItemEditRequest(html, itemId) {
  const id = clean(itemId);
  const candidates = [];
  parseForms(html).forEach((form) => {
    const idControls = form.controls.filter((control) => (
      clean(control.value) === id && /id|item|edit/i.test(control.name)
    ));
    form.controls.filter((control) => (
      control.submit
      && /edit/i.test(`${control.name} ${control.value} ${control.text}`)
      && !/delete|remove/i.test(`${control.name} ${control.value} ${control.text}`)
    )).forEach((clicked) => {
      const buttonTargetsId = clean(clicked.value) === id || clean(clicked.name).includes(id);
      if (!buttonTargetsId && !idControls.length) return;
      candidates.push({
        form,
        clicked,
        score: (buttonTargetsId ? 100 : 0) + (idControls.length === 1 ? 50 : 0),
      });
    });
  });
  candidates.sort((a, b) => b.score - a.score || a.form.index - b.form.index);
  if (candidates[0] && (!candidates[1] || candidates[0].score > candidates[1].score)) {
    return {
      action: candidates[0].form.action,
      method: candidates[0].form.method,
      entries: requestEntries(candidates[0].form, candidates[0].clicked),
    };
  }
  const links = [...String(html || "").matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)]
    .map((match) => ({ attributes: parseAttributes(`<a ${match[1]}>`), text: stripHtml(match[2]) }))
    .filter(({ attributes, text }) => (
      /edit/i.test(`${attributes.href || ""} ${text}`)
      && clean(attributes.href).includes(encodeURIComponent(id))
      && !/delete|remove/i.test(`${attributes.href || ""} ${text}`)
    ));
  if (links.length === 1) {
    const action = safePath(links[0].attributes.href);
    if (action) return { action, method: "get", entries: [] };
  }
  fail(
    "PMB did not expose one unambiguous read-only edit action for the verified portion item.",
    "PMB_PORTION_FORM_UNVERIFIED",
    503,
    { itemId: id, candidateCount: candidates.length, linkCount: links.length },
  );
}

function numericTokens(value) {
  return (String(value || "").match(/-?\d+(?:\.\d+)?/g) || []).map(Number).filter(Number.isFinite);
}

function includesNumber(value, expected) {
  return numericTokens(value).some((number) => Math.abs(number - Number(expected)) < 0.000001);
}

function priceEncoding(control, item) {
  const value = Number(String(control.value || "").replace(/[$,]/g, ""));
  if (!Number.isFinite(value)) return null;
  const dollars = item.priceRaw / (10 ** item.priceDp);
  if (Math.abs(value - dollars) < 0.000001) return "dollars";
  if (Number.isSafeInteger(value) && value === item.priceRaw) return "raw";
  return null;
}

function priceFieldScore(control) {
  const key = control.name.toLowerCase();
  if (/happy|discount|percent|_dp|decimal/.test(key)) return 0;
  if (key === "price_input") return 1100;
  if (key === "fd_price" || key === "item_price") return 1000;
  if (key === "price") return 950;
  if (/item.*price|price.*item/.test(key)) return 900;
  if (/price/.test(key)) return 600;
  return 0;
}

function nextPriceValue(control, item, newPriceRaw, encoding) {
  if (encoding === "raw") return String(newPriceRaw);
  const decimalsInForm = String(control.value || "").split(".")[1]?.length;
  const decimals = Number.isSafeInteger(decimalsInForm) ? decimalsInForm : Math.max(2, item.priceDp);
  return (newPriceRaw / (10 ** item.priceDp)).toFixed(Math.min(6, decimals));
}

function escapedRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findSaveDescriptor(html, item, expectedPortion) {
  const id = clean(item.itemId);
  const portionName = normalize(item.portionName);
  const candidates = [];
  parseForms(html).forEach((form) => {
    const saveButtons = form.controls.filter((control) => (
      control.submit
      && /save|update|apply/i.test(`${control.name} ${control.value} ${control.text}`)
      && !/cancel|delete|remove/i.test(`${control.name} ${control.value} ${control.text}`)
    ));
    if (!saveButtons.length) return;
    const plainText = stripHtml(form.html);
    const formText = normalize(plainText);
    const idEvidence = form.controls.some((control) => clean(control.value) === id && /id|item/i.test(control.name))
      || new RegExp(`(^|\\D)${escapedRegex(id)}(\\D|$)`).test(plainText);
    const portionEvidence = formText.includes(portionName)
      || form.controls.some((control) => normalize(control.value) === portionName);
    const quantityEvidence = form.controls.some((control) => (
      /quantity|qty|volume|ounce|oz/i.test(control.name)
      && includesNumber(control.value, item.quantityOz)
    )) || includesNumber(plainText, item.quantityOz);
    if (!idEvidence || !portionEvidence || !quantityEvidence) return;
    const priceControls = form.controls
      .filter((control) => !control.submit)
      .map((control) => ({ control, score: priceFieldScore(control), encoding: priceEncoding(control, item) }))
      .filter(({ score, encoding }) => score > 0 && encoding)
      .sort((a, b) => b.score - a.score || a.control.controlIndex - b.control.controlIndex);
    if (!priceControls.length || (priceControls[1] && priceControls[1].score === priceControls[0].score)) return;
    candidates.push({
      form,
      clicked: saveButtons[0],
      price: priceControls[0],
      score: priceControls[0].score + (form.controls.some((control) => clean(control.value) === id) ? 100 : 0),
    });
  });
  candidates.sort((a, b) => b.score - a.score || a.form.index - b.form.index);
  if (!candidates.length || (candidates[1] && candidates[1].score === candidates[0].score)) {
    fail(
      "PMB did not expose one unambiguous save form and price control for the verified portion item.",
      "PMB_PORTION_FORM_UNVERIFIED",
      503,
      { itemId: id, candidateCount: candidates.length },
    );
  }
  const selected = candidates[0];
  const original = requestEntries(selected.form, selected.clicked);
  const updated = original.map((entry) => (
    entry.controlIndex === selected.price.control.controlIndex
      ? { ...entry, value: nextPriceValue(entry, item, expectedPortion.newPriceRaw, selected.price.encoding) }
      : entry
  ));
  return {
    action: selected.form.action,
    method: selected.form.method,
    enctype: selected.form.enctype,
    originalEntries: original.map(({ name, value }) => [name, value]),
    updatedEntries: updated.map(({ name, value }) => [name, value]),
    target: {
      controlKey: `${id}:${selected.price.control.name}:${selected.price.control.controlIndex}`,
      itemId: id,
      productPlu: item.productPlu,
      portionName: item.portionName,
      quantityOz: item.quantityOz,
      priceDp: item.priceDp,
      currentPriceRaw: item.priceRaw,
    },
  };
}

function md5(value) {
  return crypto.createHash("md5").update(value).digest("hex");
}

function parseDigestChallenge(header) {
  const digest = String(header || "").replace(/^Digest\s+/i, "");
  const parts = digest.match(/(?:[^,"]|"[^"]*")+/g) || [];
  return parts.reduce((result, part) => {
    const [key, ...rest] = part.trim().split("=");
    if (key) result[key] = rest.join("=").replace(/^"|"$/g, "");
    return result;
  }, {});
}

function absorbCookies(headers, cookieJar) {
  const values = Array.isArray(headers?.["set-cookie"])
    ? headers["set-cookie"]
    : headers?.["set-cookie"] ? [headers["set-cookie"]] : [];
  values.forEach((value) => {
    const first = String(value).split(";")[0];
    const index = first.indexOf("=");
    if (index > 0) cookieJar.set(first.slice(0, index), first.slice(index + 1));
  });
}

function cookieHeader(cookieJar) {
  return [...cookieJar.entries()].map(([key, value]) => `${key}=${value}`).join("; ");
}

function digestAuthorization(config, method, path, challenge) {
  const qop = String(challenge.qop || "auth").split(",")[0].trim() || "auth";
  const nc = "00000001";
  const cnonce = crypto.randomBytes(8).toString("hex");
  const ha1 = md5(`${config.username}:${challenge.realm}:${config.password}`);
  const ha2 = md5(`${method}:${path}`);
  const response = md5(`${ha1}:${challenge.nonce}:${nc}:${cnonce}:${qop}:${ha2}`);
  return [
    `Digest username="${config.username}"`,
    `realm="${challenge.realm}"`,
    `nonce="${challenge.nonce}"`,
    `uri="${path}"`,
    "algorithm=MD5",
    `response="${response}"`,
    `qop=${qop}`,
    `nc=${nc}`,
    `cnonce="${cnonce}"`,
  ].join(", ");
}

function httpRequest(config, method, path, body = Buffer.alloc(0), headers = {}) {
  const url = new URL(config.baseUrl);
  const transport = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const request = transport.request({
      hostname: url.hostname,
      port: url.port || (url.protocol === "https:" ? 443 : 80),
      path,
      method,
      headers: { Accept: "text/html,*/*", "User-Agent": "OnParBeverageDashboard/1.0", ...headers },
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({
        status: response.statusCode || 0,
        headers: response.headers,
        raw: Buffer.concat(chunks).toString("utf8"),
      }));
    });
    request.on("error", reject);
    request.setTimeout(REQUEST_TIMEOUT_MS, () => request.destroy(new Error("PMB item management request timed out.")));
    if (body.length) request.write(body);
    request.end();
  });
}

async function digestRequest(config, method, path, body, headers, cookieJar) {
  const cookie = cookieHeader(cookieJar);
  const first = await httpRequest(config, method, path, body, { ...headers, ...(cookie ? { Cookie: cookie } : {}) });
  absorbCookies(first.headers, cookieJar);
  if (first.status !== 401) return first;
  const challenge = parseDigestChallenge(first.headers?.["www-authenticate"]);
  if (!challenge.realm || !challenge.nonce) return first;
  const nextCookie = cookieHeader(cookieJar);
  const result = await httpRequest(config, method, path, body, {
    ...headers,
    Authorization: digestAuthorization(config, method, path, challenge),
    ...(nextCookie ? { Cookie: nextCookie } : {}),
  });
  absorbCookies(result.headers, cookieJar);
  return result;
}

function encodedRequest(entries) {
  const body = Buffer.from(new URLSearchParams(entries.map(([name, value]) => [name, String(value ?? "")])).toString());
  return { body, headers: { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": body.byteLength } };
}

function multipartRequest(entries) {
  const boundary = `------------------------${crypto.randomBytes(12).toString("hex")}`;
  const chunks = [];
  entries.forEach(([rawName, rawValue]) => {
    const name = String(rawName || "").replace(/[\r\n"]/g, "_");
    chunks.push(Buffer.from([
      `--${boundary}`,
      `Content-Disposition: form-data; name="${name}"`,
      "",
      String(rawValue ?? ""),
      "",
    ].join("\r\n")));
  });
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  const body = Buffer.concat(chunks);
  return { body, headers: { "Content-Type": `multipart/form-data; boundary=${boundary}`, "Content-Length": body.byteLength } };
}

async function formRequest(config, descriptor, cookieJar) {
  const method = descriptor.method === "post" ? "POST" : "GET";
  const entries = descriptor.entries.map(({ name, value }) => [name, value]);
  if (method === "GET") {
    const url = new URL(descriptor.action, "http://pmb.local");
    entries.forEach(([name, value]) => url.searchParams.append(name, value));
    return digestRequest(config, "GET", `${url.pathname}${url.search}`, Buffer.alloc(0), {}, cookieJar);
  }
  const request = encodedRequest(entries);
  return digestRequest(config, "POST", descriptor.action, request.body, request.headers, cookieJar);
}

async function openVerifiedItemForm(config, item, expectedPortion) {
  const cookieJar = new Map();
  const list = await digestRequest(config, "GET", "/pages/items", Buffer.alloc(0), {}, cookieJar);
  if (list.status !== 200) fail(`PMB items page failed (${list.status || 0}).`, "PMB_PORTION_FORM_UNAVAILABLE", 502);
  const editRequest = findItemEditRequest(list.raw, item.itemId);
  const edit = await formRequest(config, editRequest, cookieJar);
  if (edit.status !== 200) fail(`PMB item edit form failed (${edit.status || 0}).`, "PMB_PORTION_FORM_UNAVAILABLE", 502);
  return { ...findSaveDescriptor(edit.raw, item, expectedPortion), cookieJar };
}

export async function preparePmbPortionManagementEdits(config, itemRows, request, schema) {
  const matching = (Array.isArray(itemRows) ? itemRows : [])
    .filter((row) => Number(row?.product_plu) === request.identity.plu)
    .map((row) => normalizePmbPortionItem(row, schema));
  const descriptors = await Promise.all(request.portions.map(async (portion) => {
    const item = matching.find((candidate) => candidate.itemId === portion.itemId);
    if (!item) fail("The verified PMB portion item is no longer available.", "PMB_PORTION_IDENTITY_CHANGED", 409);
    return openVerifiedItemForm(config, item, portion);
  }));
  verifyPmbPortionFormTargets(descriptors.map((descriptor) => descriptor.target), request);
  return descriptors;
}

export async function savePmbPortionManagementEdit(config, descriptor, { rollback = false } = {}) {
  if (descriptor.method !== "post") {
    fail("PMB exposed an unsafe non-POST item save form. No shot price was changed.");
  }
  const entries = rollback ? descriptor.originalEntries : descriptor.updatedEntries;
  const request = descriptor.enctype.includes("multipart") ? multipartRequest(entries) : encodedRequest(entries);
  const response = await digestRequest(config, "POST", descriptor.action, request.body, request.headers, descriptor.cookieJar);
  if (response.status !== 200) {
    fail(
      `PMB portion price ${rollback ? "rollback" : "save"} failed (${response.status || 0}).`,
      rollback ? "PMB_PORTION_ROLLBACK_FAILED" : "PMB_PORTION_SAVE_FAILED",
      502,
    );
  }
  return { ok: true, status: response.status };
}

function capabilityKey(config, schema, items) {
  return JSON.stringify({
    baseUrl: config.baseUrl,
    schema,
    items: items.map((item) => [item.itemId, item.priceRaw, item.priceDp]),
  });
}

export async function verifyPmbPortionManagementReadOnly(config, itemRows, schema) {
  const groups = new Map();
  (Array.isArray(itemRows) ? itemRows : []).forEach((row) => {
    const plu = Number(row?.product_plu || 0);
    if (!plu || !clean(row?.portion_name) || Number(row?.price) <= 0) return;
    if (!groups.has(plu)) groups.set(plu, []);
    groups.get(plu).push(row);
  });
  const pair = [...groups.entries()]
    .map(([plu, rows]) => ({ plu, items: rows.map((row) => normalizePmbPortionItem(row, schema)) }))
    .find(({ items }) => items.length === 2 && new Set(items.map((item) => item.itemId)).size === 2);
  if (!pair) fail("PMB did not return one two-portion product for read-only form verification.");
  const key = capabilityKey(config, schema, pair.items);
  const cached = capabilityCache.get(key);
  if (cached && Date.now() - cached.checkedAt < (cached.ok ? SUCCESS_CACHE_MS : FAILURE_CACHE_MS)) {
    if (!cached.ok) fail(cached.message, cached.code, cached.status);
    return cached;
  }
  const request = {
    identity: { plu: pair.plu },
    portions: pair.items.map((item) => ({
      itemId: item.itemId,
      name: item.portionName,
      quantityOz: item.quantityOz,
      expectedPriceRaw: item.priceRaw,
      newPriceRaw: item.priceRaw,
      priceDp: item.priceDp,
    })),
  };
  try {
    await preparePmbPortionManagementEdits(config, itemRows, request, schema);
    const result = { ok: true, checkedAt: Date.now(), code: "", message: "" };
    capabilityCache.set(key, result);
    return result;
  } catch (error) {
    const result = {
      ok: false,
      checkedAt: Date.now(),
      code: error.code || "PMB_PORTION_FORM_UNVERIFIED",
      message: error.message || "PMB item form verification failed.",
      status: Number(error.status) || 503,
    };
    capabilityCache.set(key, result);
    throw error;
  }
}
