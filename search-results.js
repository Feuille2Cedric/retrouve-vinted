// Google returns tracking URLs and page metadata, not a Vinted catalog response.
// Keep each photo, description and destination attached to the same item ID.
window.RetrouveResults = (() => {
  const text = (value = '') => {
    const doc = new DOMParser().parseFromString(String(value), 'text/html');
    return doc.body.textContent.trim();
  };
  const normalized = (value = '') => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ß/g, 'ss').toLowerCase();
  const first = (value) => Array.isArray(value) ? value[0] || {} : value || {};
  const priceValue = (value) => {
    const formatted = String(value ?? '').trim().replace(/\s/g, '').replace(',', '.');
    return /^\d+(?:\.\d{1,2})?$/.test(formatted) ? Number(formatted) : null;
  };

  function listingUrl(value) {
    try {
      let url = new URL(value);
      if (/^(?:www\.)?google\.[a-z.]+$/i.test(url.hostname) && url.pathname === '/url') {
        url = new URL(url.searchParams.get('q') || url.searchParams.get('url'));
      }
      if (!/^https?:$/.test(url.protocol) || !/^(?:www\.)?vinted\.(?:fr|be|de|es|it|nl|pt|pl|at|lu|ie|co\.uk|com)$/i.test(url.hostname)) return null;
      const id = url.pathname.match(/^\/items\/(\d+)(?:-|\/|$)/)?.[1];
      if (!id) return null;
      url.protocol = 'https:';
      url.search = '';
      url.hash = '';
      return { id, url: url.toString() };
    } catch { return null; }
  }

  function imageUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' ? url.toString() : '';
    } catch { return ''; }
  }

  function fromGoogle(result) {
    const destination = listingUrl(result.contextUrl || result.url);
    if (!destination) return null;
    const rich = first(result.richSnippet);
    let meta = first(rich.metatags);
    const metadataUrl = meta.ogUrl || meta['og:url'];
    // Never borrow metadata from another listing or a catalog page.
    if (metadataUrl && listingUrl(metadataUrl)?.id !== destination.id) meta = {};
    const title = text(meta.ogTitle || meta['og:title'] || result.titleNoFormatting || result.title).replace(/\s*[|–-]\s*Vinted\s*$/i, '').trim();
    const description = text(meta.ogDescription || meta['og:description'] || meta.twitterDescription || '');
    const images = [...new Set([
      meta.ogImage, meta['og:image'], meta.twitterImage, meta['twitter:image'],
      result.thumbnailImage?.url,
    ].map(imageUrl).filter(Boolean))];
    const ownText = `${title}\n${description}`;
    const size = normalized(ownText).match(/\b(?:taille|size|grosse|taglia|talla)(?:\s+(?:fr|de\s+l['’]article))?\s*[:\-]?\s*(xxxs|xxs|xs|s|m|l|xxxl|xxl|xl|\d{2,3}(?:[.,]\d)?)\b/i)?.[1]?.toUpperCase() || '';
    const rawPrice = meta['product:price:amount'] || meta.productPriceAmount;
    const currency = meta['product:price:currency'] || meta.productPriceCurrency;
    const price = rawPrice && ['eur', '€'].includes(String(currency).toLowerCase()) ? priceValue(rawPrice) : null;
    return {
      ...destination, title, description, images, size, price,
      // Search snippets can contain prices/sizes of recommended products. Do not use them.
      sold: /\b(vendu|vendue|sold|verkauft|vendido|vendida|esaurito)\b/.test(normalized(ownText)),
    };
  }

  function matches(item, query) {
    if (item.sold) return false;
    if (query.brand && !normalized(`${item.title} ${item.description}`).includes(normalized(query.brand))) return false;
    if (query.size && item.size && normalized(item.size) !== normalized(query.size)) return false;
    // A price criterion must not pass an item whose price is unknown.
    if ((query.minPrice || query.maxPrice) && item.price == null) return false;
    if (query.minPrice && item.price < Number(query.minPrice)) return false;
    if (query.maxPrice && item.price > Number(query.maxPrice)) return false;
    return true;
  }

  return { listingUrl, fromGoogle, matches };
})();
