const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const DEMO_LISTINGS = [];

const state = {
  listings: [...DEMO_LISTINGS],
  rejected: new Set(JSON.parse(localStorage.getItem('retrouve-rejected') || '[]')),
  favorites: new Set(JSON.parse(localStorage.getItem('retrouve-favorites') || '[]')),
  googleRejected: JSON.parse(localStorage.getItem('retrouve-google-rejected') || '{}'),
  view: 'all', source: 'idle', query: {},
};

const fields = { type: $('#itemType'), brand: $('#brand'), details: $('#details'), size: $('#size'), maxPrice: $('#maxPrice'), color: $('#color'), minRating: $('#minRating'), allowUnrated: $('#allowUnrated'), market: $('#market') };
const safeText = (value = '') => String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);

function readProfile() {
  const name = localStorage.getItem('retrouve-name') || 'toi';
  $('#inlineName').textContent = name.toLowerCase();
  $('#profileButtonName').textContent = name === 'toi' ? 'Toi' : name;
  $('#profileInitial').textContent = name === 'toi' ? 'T' : name.charAt(0).toUpperCase();
}

function persistCollections() {
  localStorage.setItem('retrouve-rejected', JSON.stringify([...state.rejected]));
  localStorage.setItem('retrouve-favorites', JSON.stringify([...state.favorites]));
  localStorage.setItem('retrouve-google-rejected', JSON.stringify(state.googleRejected));
  $('#rejectedCount').textContent = state.rejected.size + Object.keys(state.googleRejected).length;
  $('#favoriteNavCount').textContent = state.favorites.size;
}

const getQuery = () => Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, field.type === 'checkbox' ? field.checked : field.value.trim()]));

function matchesQuery(item, query) {
  const haystack = `${item.type} ${item.brand} ${item.title} ${item.color} ${item.size}`.toLowerCase();
  return (!query.type || item.type.toLowerCase() === query.type.toLowerCase())
    && (!query.brand || haystack.includes(query.brand.toLowerCase()))
    && (!query.details || query.details.toLowerCase().split(/\s+/).every((word) => haystack.includes(word)))
    && (!query.size || String(item.size).toLowerCase() === query.size.toLowerCase())
    && (!query.color || haystack.includes(query.color.toLowerCase()))
    && (!query.maxPrice || Number(item.price) <= Number(query.maxPrice))
    && (item.reviewCount === 0 || item.sellerRating == null ? query.allowUnrated !== false : (!query.minRating || Number(item.sellerRating) >= Number(query.minRating)));
}

function sortedListings(items) {
  const sort = $('#sortSelect').value;
  return [...items].sort((a, b) => {
    if (sort === 'price-asc') return a.price - b.price;
    if (sort === 'price-desc') return b.price - a.price;
    if (sort === 'newest') return b.createdAt - a.createdAt;
    return (state.favorites.has(b.id) - state.favorites.has(a.id)) || b.createdAt - a.createdAt;
  });
}

function listingUrl(item) {
  if (item.url && state.source === 'live') return item.url;
  const query = [item.brand, item.title, item.size && `taille ${item.size}`].filter(Boolean).join(' ');
  return `https://www.vinted.${fields.market.value}/catalog?search_text=${encodeURIComponent(query)}`;
}

function buildVintedSearchUrl(query = getQuery()) {
  const market = query.market || 'fr';
  const url = new URL(`https://www.vinted.${market}/catalog`);
  const searchText = [query.brand, query.details, query.type, query.color, query.size && `taille ${query.size}`].filter(Boolean).join(' ');
  if (searchText) url.searchParams.set('search_text', searchText);
  if (query.maxPrice) url.searchParams.set('price_to', query.maxPrice);
  url.searchParams.set('order', 'relevance');
  return url.toString();
}

function getSearchEngineId() {
  const rawValue = (localStorage.getItem('retrouve-google-cx') || window.RETROUVE_CONFIG?.googleSearchEngineId || '').trim();
  const urlMatch = rawValue.match(/[?&]cx=([a-z0-9:_-]+)/i);
  return (urlMatch?.[1] || rawValue).replace(/[<>"'\s].*$/, '').trim();
}

let googleSearchPromise;
let preferGoogleImages = false;
let googleResultsObserved = false;
function loadGoogleSearch() {
  if (googleSearchPromise) return googleSearchPromise;
  const engineId = getSearchEngineId();
  googleSearchPromise = new Promise((resolve, reject) => {
    let attempts = 0;
    const host = $('#googleResultsHost');
    host.className = 'gcse-search';
    host.dataset.gname = 'vinted-results';
    host.dataset.linktarget = '_blank';
    host.dataset.enableimagesearch = 'true';
    const waitForElement = () => {
      const api = window.google?.search?.cse?.element;
      const element = api?.getElement('vinted-results');
      if (element) {
        if (!googleResultsObserved) {
          googleResultsObserved = true;
          observeGoogleResults();
        }
        resolve(element);
        return;
      }
      attempts += 1;
      if (attempts >= 100) {
        googleSearchPromise = null;
        reject(new Error('Google Search timeout'));
        return;
      }
      setTimeout(waitForElement, 100);
    };
    const script = document.createElement('script');
    script.async = true;
    script.src = `https://cse.google.com/cse.js?cx=${encodeURIComponent(engineId)}`;
    script.onerror = () => {
      googleSearchPromise = null;
      reject(new Error('Google Search unavailable'));
    };
    document.head.appendChild(script);
    waitForElement();
  });
  return googleSearchPromise;
}

function googleQuery(query) {
  const domain = `www.vinted.${query.market || 'fr'}`;
  return [query.brand && `"${query.brand}"`, query.details, query.type && `"${query.type}"`, query.color, query.size && `"taille ${query.size}"`, '-vendu', '-vendue', '-sold', '-verkauft', '-vendido', `site:${domain}/items/`].filter(Boolean).join(' ');
}

function resultContradictsFilters(text, query) {
  const normalized = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
  if (query.maxPrice) {
    const price = normalized.match(/\b(\d+(?:[,.]\d{1,2})?)\s*€/);
    if (price && Number(price[1].replace(',', '.')) > Number(query.maxPrice)) return true;
  }
  if (query.size) {
    const sizes = [...normalized.matchAll(/\b(?:taille|size|grosse|taglia|talla)\s*[:\-]?\s*([a-z0-9.]+)\b/gi)].map((match) => match[1].toLowerCase());
    if (sizes.length && !sizes.includes(String(query.size).trim().toLowerCase())) return true;
  }
  return false;
}

async function executeGoogleSearch(query) {
  preferGoogleImages = true;
  const element = await loadGoogleSearch();
  element.execute(googleQuery(query));
  let checks = 0;
  const waitForResults = setInterval(() => {
    checks += 1;
    dockGoogleResults();
    decorateGoogleResults();
    if ($('#googleResultsHost .gsc-imageResult-column') || checks >= 40) clearInterval(waitForResults);
  }, 250);
}

function decorateGoogleResults() {
  document.body.classList.remove('gsc-overflow-hidden');
  const imageTab = $$('#googleResultsHost .gsc-tabHeader').find((tab) => /image/i.test(tab.textContent));
  if (preferGoogleImages && imageTab) {
    if (imageTab.classList.contains('gsc-tabhActive')) preferGoogleImages = false;
    else imageTab.click();
  }
  $$('#googleResultsHost .gsc-webResult.gsc-result, #googleResultsHost .gsc-imageResult-column').forEach((result) => {
    const titleNode = result.querySelector('.gs-title');
    const imageNode = result.querySelector('img.gs-image');
    const link = result.querySelector('a.gs-title[href]') || result.querySelector('a.gs-image[href]') || imageNode?.closest('a') || result.querySelector('a[href]');
    if (!link?.href) return;
    const url = result.dataset.originalUrl || link.href;
    result.dataset.originalUrl = url;
    const indexedText = result.textContent.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    result.dataset.sold = /\b(vendu|vendue|sold|verkauft|vendido|vendida|esaurito)\b/.test(indexedText) ? 'true' : 'false';
    result.dataset.filterMismatch = resultContradictsFilters(result.textContent, state.query) ? 'true' : 'false';
    if (state.googleRejected[url] || result.dataset.sold === 'true' || result.dataset.filterMismatch === 'true') { result.hidden = true; return; }
    result.hidden = false;
    const fallbackTitle = [state.query.brand, state.query.details, state.query.type].filter(Boolean).join(' ');
    const title = (titleNode?.textContent.trim() || imageNode?.alt?.trim() || fallbackTitle || 'Annonce Vinted').replace(/\s*[|–-]\s*Vinted\s*$/i, '').trim();
    const favoriteId = `google:${url}`;
    result.dataset.favoriteId = favoriteId;
    if (result.classList.contains('gsc-imageResult-column')) {
      const nativeImageBox = result.querySelector('.gs-image-box');
      const oldPlaceholder = result.querySelector('.google-image-placeholder');
      if (nativeImageBox) {
        nativeImageBox.classList.add('google-image-frame');
        oldPlaceholder?.remove();
      } else if (!oldPlaceholder) {
        const placeholder = document.createElement('div');
        placeholder.className = 'google-image-frame google-image-placeholder';
        placeholder.innerHTML = '<span>Photo indisponible</span>';
        result.prepend(placeholder);
      }
    }
    result.querySelectorAll('a[href]').forEach((resultLink) => {
      if (resultLink.classList.contains('google-safe-link')) return;
      resultLink.href = url;
      resultLink.removeAttribute('data-ctorig');
      resultLink.removeAttribute('onmousedown');
      resultLink.removeAttribute('onclick');
      resultLink.target = '_blank';
      resultLink.rel = 'noopener noreferrer';
      resultLink.title = 'Ouvrir cette annonce sur Vinted';
    });
    if (!result.querySelector('.google-dismiss')) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'google-dismiss'; button.textContent = '×'; button.title = 'Écarter cette annonce'; button.setAttribute('aria-label', 'Écarter cette annonce');
      result.appendChild(button);
    }
    if (!result.querySelector('.google-favorite')) {
      const favorite = document.createElement('button');
      favorite.type = 'button'; favorite.className = `google-favorite${state.favorites.has(favoriteId) ? ' is-favorite' : ''}`;
      favorite.textContent = state.favorites.has(favoriteId) ? '♥' : '♡'; favorite.setAttribute('aria-label', 'Ajouter aux favoris');
      result.appendChild(favorite);
    }
    if (!result.querySelector('.google-card-meta')) {
      const meta = document.createElement('div'); meta.className = 'google-card-meta';
      const brand = document.createElement('p'); brand.className = 'google-card-brand'; brand.textContent = state.query.brand || 'Vinted';
      const cardTitle = document.createElement('h3'); cardTitle.textContent = title;
      const details = document.createElement('p'); details.className = 'google-card-details'; details.textContent = [state.query.details, state.query.size && `Taille ${state.query.size}`, state.query.color, state.query.maxPrice && `Maximum ${state.query.maxPrice} €`, 'Annonce indexée'].filter(Boolean).join(' · ');
      const priceMatch = result.textContent.match(/\b\d+(?:[,.]\d{1,2})?\s*€/);
      const bottom = document.createElement('div'); bottom.className = 'google-card-bottom';
      const price = document.createElement('strong'); price.textContent = priceMatch?.[0] || 'Voir le prix';
      const freshLink = document.createElement('a');
      freshLink.className = 'google-safe-link';
      freshLink.href = url;
      freshLink.target = '_blank';
      freshLink.rel = 'noopener noreferrer';
      freshLink.textContent = 'Voir l’annonce →';
      bottom.append(price, freshLink); meta.append(brand, cardTitle, details, bottom); result.appendChild(meta);
    }
  });
  applyGoogleView();
}

function applyGoogleView() {
  $$('#googleResultsHost .gsc-webResult.gsc-result, #googleResultsHost .gsc-imageResult-column').forEach((result) => {
    const url = result.dataset.originalUrl;
    const isRejected = Boolean(url && state.googleRejected[url]);
    const isSold = result.dataset.sold === 'true';
    const contradictsFilters = result.dataset.filterMismatch === 'true';
    const isFavorite = Boolean(result.dataset.favoriteId && state.favorites.has(result.dataset.favoriteId));
    result.hidden = isSold || contradictsFilters || isRejected || (state.view === 'favorites' && !isFavorite);
  });
  $('#feedTitle').textContent = state.view === 'favorites' ? 'Tes coups de cœur' : (state.query.type ? `${state.query.type} rien que pour toi` : 'Les annonces Vinted');
}

function dockGoogleResults() {
  const host = $('#googleResultsHost');
  const overlay = document.querySelector('.gsc-results-wrapper-overlay');
  if (!overlay) return;
  if (!host.contains(overlay)) host.appendChild(overlay);
  overlay.classList.add('is-docked-result');
  document.body.classList.remove('gsc-overflow-hidden');
}

function observeGoogleResults() {
  const host = $('#googleResultsHost');
  // Keep native link navigation, without Google's image preview/click handlers.
  const keepListingLink = (event) => {
    const link = event.target.closest('a[href]');
    const result = link?.closest('.gsc-webResult.gsc-result, .gsc-imageResult-column');
    if (!result?.dataset.originalUrl) return;
    link.href = result.dataset.originalUrl;
    event.stopImmediatePropagation();
  };
  ['click', 'auxclick', 'mousedown'].forEach((type) => host.addEventListener(type, keepListingLink, true));
  host.addEventListener('click', (event) => {
    const button = event.target.closest('.google-favorite, .google-dismiss');
    if (!button) return;
    event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation();
    const result = button.closest('.gsc-webResult.gsc-result, .gsc-imageResult-column');
    if (!result) return;
    const url = result.dataset.originalUrl;
    const favoriteId = result.dataset.favoriteId;
    if (button.classList.contains('google-dismiss')) {
      const title = result.querySelector('.google-card-meta h3, a.gs-title')?.textContent.trim() || 'Annonce Vinted';
      state.googleRejected[url] = { title, url };
      showToast('Annonce écartée — tu peux la restaurer plus tard');
    } else {
      state.favorites.has(favoriteId) ? state.favorites.delete(favoriteId) : state.favorites.add(favoriteId);
      button.classList.toggle('is-favorite', state.favorites.has(favoriteId));
      button.textContent = state.favorites.has(favoriteId) ? '♥' : '♡';
      showToast(state.favorites.has(favoriteId) ? 'Ajouté à tes coups de cœur' : 'Retiré des favoris');
    }
    persistCollections(); applyGoogleView();
  }, true);
  let timer;
  new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(decorateGoogleResults, 80);
  }).observe(host, { childList: true, subtree: true });
  decorateGoogleResults();
}

function renderFilters() {
  const labels = { type: '', brand: '', details: '', size: 'Taille ', maxPrice: 'Jusqu’à ', color: '', minRating: 'Vendeur ≥ ', market: '' };
  const tags = Object.entries(state.query).filter(([key, value]) => value && !['market', 'allowUnrated'].includes(key)).map(([key, value]) => `${labels[key]}${value}${key === 'maxPrice' ? ' €' : key === 'minRating' ? ' ★' : ''}`);
  if (state.query.allowUnrated) tags.push('Nouveaux vendeurs acceptés');
  $('#activeFilters').innerHTML = tags.map((tag) => `<span>${safeText(tag)}</span>`).join('');
}

function renderListings() {
  $('#googleResultsWrap').hidden = true;
  $('#listingGrid').hidden = false;
  const visible = state.listings.filter((item) => !state.rejected.has(item.id)).filter((item) => state.view !== 'favorites' || state.favorites.has(item.id)).filter((item) => matchesQuery(item, state.query));
  const listings = sortedListings(visible);
  $('#listingGrid').innerHTML = listings.map((item, index) => `
    <article class="listing-card" data-id="${safeText(item.id)}" style="animation-delay:${Math.min(index * 45, 300)}ms">
      <div class="listing-image-wrap">
        <img src="${safeText(item.image)}" alt="${safeText(item.title)}" loading="lazy" />
        ${item.badge ? `<span class="listing-badge">${safeText(item.badge)}</span>` : ''}
        <button class="favorite-button${state.favorites.has(item.id) ? ' is-favorite' : ''}" type="button" aria-label="${state.favorites.has(item.id) ? 'Retirer des favoris' : 'Ajouter aux favoris'}">${state.favorites.has(item.id) ? '♥' : '♡'}</button>
        <button class="dismiss-button" type="button" aria-label="Écarter cette annonce" title="Cette annonce ne me plaît pas">×</button>
      </div>
      <div class="listing-info">
        <p class="listing-brand">${safeText(item.brand || 'Sans marque')}</p><h3 class="listing-title">${safeText(item.title)}</h3>
        <p class="listing-meta">Taille ${safeText(item.size || '—')} · ${safeText(item.condition || 'État non indiqué')} ${item.reviewCount === 0 || item.sellerRating == null ? '<span class="seller-rating new">Nouveau vendeur</span>' : `<span class="seller-rating">★ ${Number(item.sellerRating).toFixed(1).replace('.', ',')} (${Number(item.reviewCount)})</span>`}</p>
        <div class="listing-bottom"><span class="listing-price">${Number(item.price).toLocaleString('fr-FR')} €</span><span class="listing-location">${safeText(item.country || '')}</span><a class="listing-link" href="${safeText(listingUrl(item))}" target="_blank" rel="noopener noreferrer">${state.source === 'live' ? 'Voir l’annonce' : 'Chercher sur Vinted'} ↗</a></div>
      </div>
    </article>`).join('');
  $('#emptyState').hidden = listings.length > 0;
  $('#feedEyebrow').textContent = state.view === 'favorites' ? 'Ta sélection gardée au chaud' : `${listings.length} trouvaille${listings.length > 1 ? 's' : ''} visible${listings.length > 1 ? 's' : ''}`;
  $('#feedTitle').textContent = state.view === 'favorites' ? 'Tes coups de cœur' : (state.query.type ? `${state.query.type} rien que pour toi` : 'Les dernières trouvailles');
  renderFilters(); persistCollections();
}

function showToast(message) {
  const toast = $('#toast'); toast.textContent = message; toast.classList.add('show'); clearTimeout(showToast.timer); showToast.timer = setTimeout(() => toast.classList.remove('show'), 2200);
}

$('#listingGrid').addEventListener('click', (event) => {
  const card = event.target.closest('.listing-card'); if (!card) return; const id = card.dataset.id;
  if (event.target.closest('.favorite-button')) { state.favorites.has(id) ? state.favorites.delete(id) : state.favorites.add(id); showToast(state.favorites.has(id) ? 'Ajouté à tes coups de cœur' : 'Retiré des favoris'); renderListings(); }
  if (event.target.closest('.dismiss-button')) { state.rejected.add(id); showToast('Annonce écartée — tu peux la restaurer plus tard'); renderListings(); }
});

async function searchListings(query) {
  state.query = query;
  $('.feed-panel').classList.add('is-searching');
  $('#sourceNotice').classList.remove('is-live');
  $('#sourceNotice').classList.add('is-searching');
  $('#sourceNotice').innerHTML = '<span>Recherche</span><p>Je parcours les annonces et prépare les cartes illustrées…</p>';
  $('#listingGrid').hidden = true;
  $('#googleResultsWrap').hidden = true;
  $('#emptyState').hidden = true;
  $('#loadingState').hidden = false;
  const apiUrl = window.RETROUVE_CONFIG?.apiUrl?.trim();
  if (apiUrl) {
    try {
      const url = new URL(apiUrl); Object.entries(query).forEach(([key, value]) => (value || value === false) && url.searchParams.set(key, String(value)));
      const response = await fetch(url, { headers: { Accept: 'application/json' } }); if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json(); if (!Array.isArray(payload.items)) throw new Error('Format de réponse invalide');
      state.listings = payload.items.map((item, index) => ({ ...item, id: String(item.id ?? `live-${index}`), createdAt: item.createdAt ?? 0 })); state.source = 'live';
      $('#sourceNotice').classList.add('is-live'); $('#sourceNotice').innerHTML = '<span>En direct</span><p>Les annonces viennent de ta source connectée.</p>';
    } catch (error) { state.listings = [...DEMO_LISTINGS]; state.source = 'demo'; showToast('Source indisponible : affichage de l’aperçu'); }
  } else if (getSearchEngineId()) {
    try {
      await executeGoogleSearch(query);
      state.source = 'google';
      $('#loadingState').hidden = true;
      $('#listingGrid').hidden = true;
      $('#emptyState').hidden = true;
      $('#googleResultsWrap').hidden = false;
      $('#feedEyebrow').textContent = 'Résultats trouvés sur le web';
      $('#feedTitle').textContent = query.type ? `${query.type} rien que pour toi` : 'Les annonces Vinted';
      $('#sourceNotice').classList.add('is-live');
      $('#sourceNotice').classList.remove('is-searching');
      $('.feed-panel').classList.remove('is-searching');
      $('#sourceNotice').innerHTML = '<span>Intégré</span><p>Les annonces Vinted indexées par Google sont affichées sur cette page. La note vendeur reste disponible uniquement avec une API dédiée.</p>';
      renderFilters(); persistCollections();
      return;
    } catch (error) {
      $('#sourceNotice').classList.remove('is-searching');
      $('.feed-panel').classList.remove('is-searching');
      showToast('Le moteur intégré n’a pas pu charger. Vérifie son identifiant.');
      state.listings = [...DEMO_LISTINGS]; state.source = 'demo';
    }
  } else { await new Promise((resolve) => setTimeout(resolve, 450)); state.listings = [...DEMO_LISTINGS]; state.source = 'demo'; }
  $('#sourceNotice').classList.remove('is-searching');
  $('.feed-panel').classList.remove('is-searching');
  $('#loadingState').hidden = true; $('#listingGrid').hidden = false; renderListings();
}

$('#searchForm').addEventListener('submit', (event) => {
  event.preventDefault();
  if (!event.currentTarget.reportValidity()) return;
  const query = getQuery();
  if (!window.RETROUVE_CONFIG?.apiUrl?.trim() && !getSearchEngineId()) {
    openSourceDialog();
    showToast('Connecte une source pour récupérer les annonces');
    return;
  }
  searchListings(query);
});
$('#resetFilters').addEventListener('click', () => { $('#searchForm').reset(); state.query = {}; state.listings = [...DEMO_LISTINGS]; renderListings(); });
$('#emptyReset').addEventListener('click', () => { state.query = {}; $('#searchForm').reset(); renderListings(); });
$('#sortSelect').addEventListener('change', renderListings);
$$('.nav-link').forEach((button) => button.addEventListener('click', () => {
  $$('.nav-link').forEach((item) => item.classList.remove('active'));
  button.classList.add('active');
  state.view = button.dataset.view;
  if (state.source === 'google') {
    $('#googleResultsWrap').hidden = false;
    $('#listingGrid').hidden = true;
    $('#emptyState').hidden = true;
    applyGoogleView();
  } else renderListings();
}));

const profileDialog = $('#profileDialog');
function openProfile() { $('#nameInput').value = localStorage.getItem('retrouve-name') || ''; profileDialog.showModal(); setTimeout(() => $('#nameInput').focus(), 50); }
$('#profileButton').addEventListener('click', openProfile); $('#inlineName').addEventListener('click', openProfile);
$('#closeProfile').addEventListener('click', () => profileDialog.close());
$('#profileForm').addEventListener('submit', (event) => { event.preventDefault(); const name = $('#nameInput').value.trim(); localStorage.setItem('retrouve-name', name || 'toi'); readProfile(); profileDialog.close(); showToast('C’est enregistré !'); });

const rejectedDialog = $('#rejectedDialog');
function renderRejected() {
  const items = state.listings.filter((item) => state.rejected.has(item.id));
  const googleItems = Object.values(state.googleRejected);
  const demoMarkup = items.map((item) => `<div class="rejected-item" data-id="${safeText(item.id)}"><img src="${safeText(item.image)}" alt="" /><span><strong>${safeText(item.title)}</strong><small>${safeText(item.brand)} · ${item.price} €</small></span><button type="button">Restaurer</button></div>`).join('');
  const googleMarkup = googleItems.map((item) => `<div class="rejected-item" data-google-url="${safeText(item.url)}"><span class="rejected-placeholder">↗</span><span><strong>${safeText(item.title)}</strong><small>Résultat Vinted intégré</small></span><button type="button">Restaurer</button></div>`).join('');
  $('#rejectedList').innerHTML = demoMarkup + googleMarkup || '<p class="modal-subtitle">Aucune annonce écartée pour l’instant.</p>';
  $('#restoreAll').hidden = !(items.length || googleItems.length);
}
$('#rejectedButton').addEventListener('click', () => { renderRejected(); rejectedDialog.showModal(); }); $('#closeRejected').addEventListener('click', () => rejectedDialog.close());
$('#rejectedList').addEventListener('click', (event) => {
  const item = event.target.closest('.rejected-item'); if (!item || !event.target.closest('button')) return;
  if (item.dataset.googleUrl) { delete state.googleRejected[item.dataset.googleUrl]; decorateGoogleResults(); } else { state.rejected.delete(item.dataset.id); }
  persistCollections(); renderRejected(); if (state.source !== 'google') renderListings();
});
$('#restoreAll').addEventListener('click', () => {
  state.rejected.clear(); state.googleRejected = {}; applyGoogleView();
  persistCollections(); renderRejected(); if (state.source !== 'google') renderListings();
});
function openSourceDialog() { $('#searchEngineId').value = getSearchEngineId(); $('#sourceDialog').showModal(); }
function showIntegratedResults() {
  if (window.RETROUVE_CONFIG?.apiUrl?.trim() || getSearchEngineId()) searchListings(getQuery());
  else openSourceDialog();
}
$('#sourceHelp').addEventListener('click', openSourceDialog); $('#configureResults').addEventListener('click', showIntegratedResults); $('#emptyConfigure').addEventListener('click', showIntegratedResults); $('#closeSource').addEventListener('click', () => $('#sourceDialog').close());
$('#saveSearchEngine').addEventListener('click', () => {
  const rawValue = $('#searchEngineId').value.trim();
  const urlMatch = rawValue.match(/[?&]cx=([a-z0-9:_-]+)/i);
  const engineId = (urlMatch?.[1] || rawValue).replace(/[<>"'\s].*$/, '').trim();
  if (!engineId) { showToast('Colle d’abord l’identifiant du moteur Google'); return; }
  localStorage.setItem('retrouve-google-cx', engineId); $('#sourceDialog').close(); showToast('Moteur connecté — rechargement…'); setTimeout(() => location.reload(), 700);
});

const imageInput = $('#imageInput'); let imageFile = null;
$('#photoDrop').addEventListener('click', () => imageInput.click());
imageInput.addEventListener('change', () => {
  const file = imageInput.files[0]; if (!file || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return; imageFile = file;
  $('#photoPreview').src = URL.createObjectURL(file); $('#photoName').textContent = file.name; $('#photoPrompt').hidden = true; $('#photoPreviewWrap').hidden = false; $('#analyzePhoto').disabled = false;
});

function loadScript(src) { return new Promise((resolve, reject) => { const script = document.createElement('script'); script.src = src; script.onload = resolve; script.onerror = reject; document.head.appendChild(script); }); }
const translations = [[/running shoe|sneaker|shoe/i, 'Baskets'], [/boot/i, 'Bottes'], [/sweater|cardigan|jersey/i, 'Pull'], [/coat/i, 'Manteau'], [/jacket/i, 'Veste'], [/jean/i, 'Jean'], [/shirt/i, 'T-shirt'], [/dress/i, 'Robe'], [/handbag|purse|backpack/i, 'Sac']];
$('#analyzePhoto').addEventListener('click', async () => {
  if (!imageFile) return; const button = $('#analyzePhoto'); button.disabled = true; button.textContent = '✦  Analyse en cours…'; const message = $('#analysisMessage'); message.hidden = false; message.textContent = 'Je charge le modèle visuel…';
  try {
    if (!window.tf) await loadScript('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js'); if (!window.mobilenet) await loadScript('https://cdn.jsdelivr.net/npm/@tensorflow-models/mobilenet@2.1.1/dist/mobilenet.min.js');
    const model = await window.mobilenet.load({ version: 2, alpha: 1 }); const predictions = await model.classify($('#photoPreview'), 4); const detected = translations.find(([pattern]) => predictions.some((prediction) => pattern.test(prediction.className)))?.[1];
    if (detected) fields.type.value = detected; message.textContent = detected ? `Je pense à : ${detected}. Vérifie le choix puis lance la recherche.` : `Pistes détectées : ${predictions.slice(0, 2).map((item) => item.className).join(', ')}.`;
  } catch (error) { message.textContent = 'L’analyse n’a pas pu être chargée. Tu peux continuer sans elle.'; } finally { button.disabled = false; button.innerHTML = '<span>✦</span> Analyser à nouveau'; }
});

if (!window.RETROUVE_CONFIG?.apiUrl?.trim()) $('#submitLabel').textContent = getSearchEngineId() ? 'Afficher les annonces ici' : 'Configurer les résultats';
readProfile(); persistCollections(); renderListings();
