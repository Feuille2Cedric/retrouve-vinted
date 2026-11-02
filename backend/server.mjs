import { createServer } from 'node:http';
import { VintedClient, opSearch } from '@googlarz/vinted-client';
import { chromium } from 'playwright';

const PORT = Number(process.env.PORT || 8000);
const ALLOWED_ORIGINS = new Set([
  'https://feuille2cedric.github.io',
  'http://localhost:8080',
  'http://127.0.0.1:8080',
]);
const COUNTRIES = new Set([
  'fr', 'de', 'uk', 'it', 'es', 'nl', 'pl', 'pt', 'be', 'at',
  'lt', 'cz', 'sk', 'hu', 'ro', 'hr', 'fi', 'dk', 'se',
]);
const sellerCache = new Map();
const client = new VintedClient({ cacheTtlMs: 60_000, timeoutMs: 25_000 });
let browserPromise;

function sendJson(response, status, payload, origin = '') {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...(ALLOWED_ORIGINS.has(origin) ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}),
  });
  response.end(JSON.stringify(payload));
}

function clean(value) {
  return String(value || '').trim();
}

function numberParam(params, name) {
  const raw = clean(params.get(name));
  if (!raw) return undefined;
  const value = Number(raw.replace(',', '.'));
  return Number.isFinite(value) ? value : undefined;
}

function boolParam(params, name, fallback) {
  const raw = clean(params.get(name)).toLowerCase();
  if (!raw) return fallback;
  return raw !== 'false' && raw !== '0';
}

function sameText(left, right) {
  return clean(left).localeCompare(clean(right), 'fr', { sensitivity: 'base' }) === 0;
}

async function getSeller(sellerId, country) {
  if (!sellerId) return null;
  const key = `${country}:${sellerId}`;
  const cached = sellerCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  try {
    const payload = await client.apiGet(country, `/api/v2/users/${sellerId}`, 300_000);
    const user = payload?.user || payload;
    const reputation = Number(user?.feedback_reputation);
    const value = {
      rating: Number.isFinite(reputation) ? (reputation <= 1 ? reputation * 5 : reputation) : null,
      reviews: Number.isFinite(Number(user?.feedback_count)) ? Number(user.feedback_count) : 0,
      country: clean(user?.country_code),
    };
    sellerCache.set(key, { value, expiresAt: Date.now() + 300_000 });
    return value;
  } catch {
    return null;
  }
}

function proxyOptions() {
  const raw = clean(process.env.VINTED_PROXY_URL);
  if (!raw) return undefined;
  const parsed = new URL(raw);
  return {
    server: `${parsed.protocol}//${parsed.hostname}:${parsed.port}`,
    username: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
  };
}

async function getBrowser() {
  if (!browserPromise) {
    browserPromise = chromium.launch({
      headless: true,
      proxy: proxyOptions(),
      args: ['--disable-dev-shm-usage', '--no-sandbox'],
    }).catch((error) => {
      browserPromise = undefined;
      throw error;
    });
  }
  return browserPromise;
}

function matchingBracket(value, start) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < value.length; index += 1) {
    const char = value[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '[' || char === '{') depth += 1;
    else if (char === ']' || char === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function mapBrowserItem(entry, domain) {
  const product = entry.productItem || entry;
  const box = product.itemBox || {};
  const secondLine = typeof box.secondLine === 'string' && box.secondLine !== '$undefined' ? box.secondLine : '';
  const parts = secondLine.split(' · ');
  const path = String(product.url || `/items/${product.id || entry.id}`);
  return {
    id: Number(product.id || entry.id),
    title: String(product.title || ''),
    price: String(product.price?.amount || ''),
    brand: typeof box.firstLine === 'string' ? box.firstLine : undefined,
    size: parts.length > 1 ? parts[0] : undefined,
    condition: parts.length > 1 ? parts.slice(1).join(' · ') : parts[0] || undefined,
    url: /^https?:/.test(path) ? path : `https://${domain}${path.split('?')[0]}`,
    photoUrl: product.photos?.[0]?.url || product.thumbnailUrl || '',
    seller: { id: Number(product.user?.id || 0), username: '' },
  };
}

async function browserSearch({ query, country, priceMin, priceMax }) {
  const domain = country === 'uk' ? 'www.vinted.co.uk' : `www.vinted.${country}`;
  const search = new URLSearchParams({ search_text: query, page: '1', order: 'relevance' });
  if (priceMin !== undefined) search.set('price_from', String(priceMin));
  if (priceMax !== undefined) search.set('price_to', String(priceMax));
  const browser = await getBrowser();
  const context = await browser.newContext({
    locale: country === 'fr' ? 'fr-FR' : 'en-US',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();
  try {
    const response = await page.goto(`https://${domain}/catalog?${search}`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    if (!response || response.status() >= 400) throw new Error(`Vinted catalog returned ${response?.status() || 'no response'}`);
    const html = await page.content();
    let flight = '';
    for (const match of html.matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g)) {
      try { flight += JSON.parse(match[1]); } catch { /* ignore malformed RSC chunk */ }
    }
    const marker = '"items":{"items":[';
    const markerAt = flight.indexOf(marker);
    if (markerAt < 0) throw new Error('Vinted catalog list was not present in the browser response');
    const start = markerAt + marker.length - 1;
    const end = matchingBracket(flight, start);
    if (end < 0) throw new Error('Vinted catalog response was truncated');
    const entries = JSON.parse(flight.slice(start, end + 1));
    return { items: entries.map((entry) => mapBrowserItem(entry, domain)) };
  } finally {
    await context.close();
  }
}

async function search(params) {
  const type = clean(params.get('type'));
  const gender = clean(params.get('gender'));
  const brand = clean(params.get('brand'));
  const details = clean(params.get('details'));
  const size = clean(params.get('size'));
  const color = clean(params.get('color'));
  const minPrice = numberParam(params, 'minPrice');
  const maxPrice = numberParam(params, 'maxPrice');
  const minRating = numberParam(params, 'minRating');
  const allowUnrated = boolParam(params, 'allowUnrated', true);
  const requestedMarket = clean(params.get('market')).replace('co.uk', 'uk');
  const country = COUNTRIES.has(requestedMarket) ? requestedMarket : 'fr';
  const query = [gender, brand, details, type, color].filter(Boolean).join(' ');
  if (!query) return { items: [] };

  const result = process.env.VINTED_PROXY_URL
    ? await browserSearch({ query, country, priceMin: minPrice, priceMax: maxPrice })
    : await opSearch(client, { query, country, priceMin: minPrice, priceMax: maxPrice, sortBy: 'relevance', perPage: 96 });

  const candidates = result.items.filter((item) => {
    const price = Number(item.price);
    if (!Number.isFinite(price)) return false;
    if (minPrice !== undefined && price < minPrice) return false;
    if (maxPrice !== undefined && price > maxPrice) return false;
    if (size && !sameText(item.size, size)) return false;
    if (brand && item.brand && !sameText(item.brand, brand)) return false;
    return Boolean(item.id && item.url);
  });

  const needsSeller = minRating !== undefined || !allowUnrated;
  const items = [];
  for (const item of candidates) {
    const seller = needsSeller ? await getSeller(item.seller?.id, country) : null;
    const reviewCount = seller?.reviews || 0;
    if (!allowUnrated && reviewCount === 0) continue;
    if (minRating !== undefined && reviewCount > 0 && (seller?.rating ?? 0) < minRating) continue;
    items.push({
      id: String(item.id),
      title: item.title || 'Annonce Vinted',
      type,
      brand: item.brand || brand || 'Sans marque',
      size: item.size || '',
      color,
      price: Number(item.price),
      country: seller?.country || country.toUpperCase(),
      condition: item.condition || 'État non indiqué',
      sellerRating: seller?.rating ?? null,
      reviewCount,
      image: item.photoUrl || '',
      url: item.url,
      createdAt: 0,
    });
  }
  return { items };
}

createServer(async (request, response) => {
  const origin = clean(request.headers.origin);
  if (request.method === 'OPTIONS') {
    response.writeHead(204, {
      ...(ALLOWED_ORIGINS.has(origin) ? { 'Access-Control-Allow-Origin': origin } : {}),
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Accept, Content-Type',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    });
    response.end();
    return;
  }

  const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
  if (request.method === 'GET' && url.pathname === '/health') {
    sendJson(response, 200, {
      status: 'ok',
      engine: '@googlarz/vinted-client',
      version: clean(process.env.RENDER_GIT_COMMIT).slice(0, 7) || 'local',
      proxyConfigured: Boolean(process.env.VINTED_PROXY_URL),
    }, origin);
    return;
  }
  if (request.method === 'GET' && url.pathname === '/search') {
    try {
      sendJson(response, 200, await search(url.searchParams), origin);
    } catch (error) {
      console.error('Vinted search failed:', error);
      const message = error instanceof Error ? error.message : String(error);
      const hint = /proxy|cloudflare|blocked|403/i.test(message)
        ? `Vinted bloque actuellement la connexion du serveur (${message}).`
        : `Vinted est temporairement indisponible (${message}).`;
      sendJson(response, 502, { detail: hint }, origin);
    }
    return;
  }
  sendJson(response, 404, { detail: 'Route introuvable' }, origin);
}).listen(PORT, '0.0.0.0', () => {
  console.log(`re:trouve API listening on ${PORT}`);
});
