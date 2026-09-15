import { digestRequest, getConfig, urlEncodedBody } from './pmb-product-management.mjs';
import { parsePmbProductEditForm } from './pmb-price-update.mjs';

async function readProductForm(config, plu) {
  const request = urlEncodedBody([['fd_edit_plu', String(plu)], ['submit_edit_product', 'edit']]);
  const response = await digestRequest(config, 'POST', '/pages/products', request.body, { ...request.headers, Connection: 'close' }, new Map());
  if (response.status !== 200) throw new Error('Product read failed.');
  return { html: response.raw };
}

function plain(value) {
  return String(value || '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'").replace(/&#(\d+);/g, (_, n) => Number(n) <= 0x10ffff ? String.fromCodePoint(Number(n)) : '')
    .replace(/\s+/g, ' ').trim();
}
function attribute(tag, name) {
  return tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'))?.slice(1).find(v => v !== undefined) || '';
}

// Return text only, never controller HTML, scripts, cookies, or arbitrary form values.
export function describePmbProductReportPage(html) {
  const safe = String(html).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');
  const links = [...safe.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].map(m => ({
    label: plain(m[2]), path: attribute(m[1], 'href').replace(/&amp;/g, '&'),
  })).filter(link => /^\/pages\/[a-z0-9_-]+$/i.test(link.path)
    && /report|pour|product/i.test(link.label + ' ' + link.path)
    && !/delete|save|reset|activate/i.test(link.label + ' ' + link.path));
  const tables = [...safe.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)].slice(0, 12).map(table => ({
    rows: [...table[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].slice(0, 1000).map(row => (
      [...row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(cell => plain(cell[1]).slice(0, 500))
    )).filter(row => row.some(Boolean)),
  }));
  const filters = [...safe.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>/gi)].map(select => ({
    name: attribute(select[1], 'name'),
    options: [...select[2].matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/gi)].slice(0, 1000)
      .map(option => ({ label: plain(option[2]), value: attribute(option[1], 'value') })),
  })).filter(filter => filter.name && !/password|secret|token|customer|card/i.test(filter.name));
  const navigation = [...safe.matchAll(/<(?:a|frame|iframe)\b([^>]*)>/gi)].map(m => attribute(m[1], 'href') || attribute(m[1], 'src')).filter(p => /^\/?[a-z0-9_./-]+(?:\?[a-z0-9_=&%-]+)?$/i.test(p)).slice(0, 100);
  const forms = [...safe.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)].map(form => ({
    action: attribute(form[1], 'action'), method: attribute(form[1], 'method'),
    controls: [...form[2].matchAll(/<(?:input|button)\b([^>]*)>/gi)].map(m => ({name: attribute(m[1], 'name'), type: attribute(m[1], 'type')})).filter(c => c.name && !/password|secret|token|customer|card/i.test(c.name)),
  }));
  return { links, tables, filters, navigation, forms };
}

export function parseReportHistoryRequest(params) {
  if ([...params.keys()].some(key => !['view', 'plus'].includes(key))) throw Object.assign(new Error('Unsupported report parameter.'), { status: 422 });
  const view = params.get('view') || 'catalog';
  if (!['catalog', 'menu', 'home', 'products'].includes(view)) throw Object.assign(new Error('Choose catalog, menu, home, or products.'), { status: 422 });
  const raw = params.get('plus') || '';
  const plus = raw ? raw.split(',').map(value => /^\d+$/.test(value) ? Number(value) : NaN) : [];
  if ((view === 'products' && !plus.length) || (view !== 'products' && raw)
    || plus.length > 8 || plus.some(value => !Number.isSafeInteger(value) || value <= 0)) {
    throw Object.assign(new Error('Provide one to eight positive product IDs for the products view.'), { status: 422 });
  }
  return { view, plus: [...new Set(plus)] };
}

export async function readPmbReportHistory(input, { config = getConfig(), readPage = digestRequest, readProduct = readProductForm } = {}) {
  if (input.view === 'products') {
    const products = [];
    for (const plu of input.plus) {
      try {
        // Opens the existing record only; no save or activation request exists here.
        const { html } = await readProduct(config, plu);
        const entries = parsePmbProductEditForm(html);
        const values = key => entries.filter(([name]) => name === key).map(([, value]) => value);
        const ids = values('fd_plu'), names = values('fd_name');
        if (ids.length !== 1 || Number(ids[0]) !== plu || names.length !== 1 || !names[0].trim()) {
          throw new Error('The controller did not return this exact product identity.');
        }
        products.push({ plu, name: names[0].trim(), identityVerified: true });
      } catch {
        products.push({ plu, name: null, identityVerified: false, warning: 'The retired product identity could not be verified.' });
      }
    }
    return { products };
  }
  const path = input.view === 'catalog' ? '/pages/products' : input.view === 'home' ? '/' : '/pages/tapconfig';
  const result = await readPage(config, 'GET', path, Buffer.alloc(0), { Connection: 'close' }, new Map());
  if (result.status !== 200) throw Object.assign(new Error(`PMB report lookup failed (${result.status || 0}).`), { status: 502 });
  const described = describePmbProductReportPage(result.raw);
  return described;
}
