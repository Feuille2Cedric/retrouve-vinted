import { createServer } from 'node:http';
import { VintedClient } from '@googlarz/vinted-client';
import { gotScraping } from 'got-scraping';

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

function decodeHtml(value) {
  return String(value || '')
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>');
}

function parseHtmlItems(html, domain) {
  const items = [];
  const links = html.matchAll(/<a href="([^"]+)"[^>]*data-testid="product-item-id-(\d+)--overlay-link"[^>]*title="([^"]*)"/g);
  for (const link of links) {
    const [, path, rawId, rawDescription] = link;
    const before = html.slice(Math.max(0, link.index - 3_000), link.index);
    const imageMatches = [...before.matchAll(/<img src="([^"]+)"[^>]*data-testid="product-item-id-(\d+)--image--img"/g)];
    const image = imageMatches.findLast((match) => match[2] === rawId);
    const description = decodeHtml(rawDescription);
    const title = description.split(/,\s*Marque:/i)[0].trim();
    const brand = description.match(/Marque:\s*([^,]+)/i)?.[1]?.trim();
    const condition = description.match(/(?:État|Etat):\s*([^,]+)/i)?.[1]?.trim();
    const size = description.match(/Taille:\s*([^,]+)/i)?.[1]?.trim();
    const price = description.match(/,\s*(\d+(?:[.,]\d{1,2})?)\s*€/i)?.[1]?.replace(',', '.');
    if (!price) continue;
    items.push({
      id: Number(rawId),
      title,
      price,
      brand,
      size,
      condition,
      url: `https://${domain}${decodeHtml(path).split('?')[0]}`,
      photoUrl: image ? decodeHtml(image[1]) : '',
      seller: { id: 0, username: '' },
    });
  }
  return items;
}

async function lightweightSearch({ query, country, priceMin, priceMax }) {
  const domain = country === 'uk' ? 'www.vinted.co.uk' : `www.vinted.${country}`;
  const search = new URLSearchParams({ search_text: query, page: '1', order: 'relevance' });
  if (priceMin !== undefined) search.set('price_from', String(priceMin));
  if (priceMax !== undefined) search.set('price_to', String(priceMax));
  const url = `https://${domain}/catalog?${search}`;
  const requestOptions = {
    throwHttpErrors: false,
    retry: { limit: 0 },
    timeout: { request: 45_000 },
    headerGeneratorOptions: {
      browsers: [{ name: 'chrome', minVersion: 120 }],
      devices: ['desktop'],
      locales: country === 'fr' ? ['fr-FR', 'fr'] : ['en-US', 'en'],
      operatingSystems: ['windows'],
    },
    headers: {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': country === 'fr' ? 'fr-FR,fr;q=0.9,en;q=0.7' : 'en-US,en;q=0.9',
    },
  };
  const requestWithSession = async (proxyUrl) => {
    const sessionToken = {};
    const proxyOptions = proxyUrl ? { proxyUrl } : {};
    let cookie = '';
    try {
      const bootstrap = await gotScraping({
        ...requestOptions,
        ...proxyOptions,
        url: `https://${domain}/catalog`,
        sessionToken,
      });
      const setCookies = bootstrap.headers['set-cookie'];
      cookie = (Array.isArray(setCookies) ? setCookies : setCookies ? [setCookies] : [])
        .map((value) => value.split(';', 1)[0])
        .join('; ');
    } catch { /* the catalog request below will expose the actual failure */ }
    return gotScraping({
      ...requestOptions,
      ...proxyOptions,
      url,
      sessionToken,
      headers: {
        ...requestOptions.headers,
        Referer: `https://${domain}/catalog`,
        ...(cookie ? { Cookie: cookie } : {}),
      },
    });
  };
  let response;
  const proxyUrl = clean(process.env.VINTED_PROXY_URL);
  if (proxyUrl) {
    try {
      response = await requestWithSession(proxyUrl);
    } catch { /* retry directly below */ }
  }
  if (!response || response.statusCode >= 400) {
    response = await requestWithSession('');
  }
  if (response.statusCode >= 400) throw new Error(`Vinted catalog returned ${response.statusCode}`);
  const html = response.body;
  const htmlItems = parseHtmlItems(html, domain);
  if (htmlItems.length) return { items: htmlItems };
  let flight = '';
  for (const match of html.matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g)) {
    try { flight += JSON.parse(match[1]); } catch { /* ignore malformed RSC chunk */ }
  }
  const marker = '"items":{"items":[';
  const markerAt = flight.indexOf(marker);
  if (markerAt < 0) throw new Error('Vinted catalog list was not present in the HTTP response');
  const start = markerAt + marker.length - 1;
  const end = matchingBracket(flight, start);
  if (end < 0) throw new Error('Vinted catalog response was truncated');
  const entries = JSON.parse(flight.slice(start, end + 1));
  return { items: entries.map((entry) => mapBrowserItem(entry, domain)) };
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

  const result = await lightweightSearch({ query, country, priceMin: minPrice, priceMax: maxPrice });

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
      engine: 'got-scraping',
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
        ? 'Vinted bloque actuellement la connexion du serveur.'
        : 'Vinted est temporairement indisponible.';
      sendJson(response, 502, { detail: hint }, origin);
    }
    return;
  }
  sendJson(response, 404, { detail: 'Route introuvable' }, origin);
}).listen(PORT, '0.0.0.0', () => {
  console.log(`re:trouve API listening on ${PORT}`);
});
