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
  return (!query.type || !item.type || String(item.type).toLowerCase() === query.type.toLowerCase())
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
let pendingGoogleSearch;
let googleResultsContainer;
let googlePageItems = [];
let googleVisibleLimit = Infinity;
let googleRefill;
let googleAppendNext = false;
const savedGoogleItems = JSON.parse(localStorage.getItem('retrouve-google-items') || '{}');

function availableGoogleItems() {
  return googlePageItems.filter((item) => !state.googleRejected[item.id]
    && RetrouveResults.matches(item, state.query)
    && (!$('#photosOnly').checked || item.images.length));
}

function stopGoogleRefill(message = '') {
  clearTimeout(googleRefill?.timer);
  clearTimeout(googleRefill?.timeout);
  googleRefill = null;
  $('#googleResultsHost').classList.remove('is-refilling');
  $('#refillStatus').textContent = message;
}

function requestGoogleRefill(target) {
  if (state.view !== 'all' || pendingGoogleSearch || state.source !== 'google') return;
  // A timed-out request may still be waiting for Google's verification.
  if (googleAppendNext && !googleRefill) return;
  if (availableGoogleItems().length >= target) return;
  if (!googleRefill) googleRefill = { target, attempts: 0, busy: false, query: state.query };
  googleRefill.target = Math.max(googleRefill.target, target);
  if (googleRefill.busy) return;
  clearTimeout(googleRefill.timer);
  $('#refillStatus').textContent = 'Je cherche de nouvelles annonces…';
  googleRefill.timer = setTimeout(loadNextGooglePage, 400);
}

function loadNextGooglePage() {
  const refill = googleRefill;
  if (!refill || refill.busy) return;
  if (refill.query !== state.query || state.view !== 'all') { stopGoogleRefill(); return; }
  if (availableGoogleItems().length >= refill.target) { stopGoogleRefill('De nouvelles annonces ont été ajoutées.'); return; }
  if (refill.attempts >= 3) { stopGoogleRefill('Pas d’autre annonce correspondante dans les pages chargées.'); return; }
  const currentPage = Number($('#googleResultsHost .gsc-cursor-current-page')?.textContent);
  const nextPage = $$('#googleResultsHost .gsc-cursor-page').find((page) => Number(page.textContent) === currentPage + 1);
  if (!currentPage || !nextPage) { stopGoogleRefill('Aucune page supplémentaire disponible.'); return; }
  refill.busy = true;
  refill.attempts += 1;
  googleAppendNext = true;
  $('#googleResultsHost').classList.add('is-refilling');
  refill.timeout = setTimeout(() => {
    if (googleRefill === refill) stopGoogleRefill('Le chargement est en pause. Si Google demande une vérification ci-dessous, complète-la pour continuer.');
  }, 15000);
  nextPage.click();
}

function googleQuery(query) {
  const words = [query.brand, query.details, query.type, query.color, query.size && `taille ${query.size}`].filter(Boolean).join(' ');
  return `${words} site:www.vinted.${query.market || 'fr'}/items/`;
}

function loadGoogleSearch() {
  const existing = window.google?.search?.cse?.element?.getElement('vinted-results');
  if (existing) return Promise.resolve(existing);
  if (googleSearchPromise) return googleSearchPromise;
  googleSearchPromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { googleSearchPromise = null; reject(new Error('Le moteur Google ne répond pas.')); }, 15000);
    window.__gcse = {
      parsetags: 'explicit',
      initializationCallback: () => {
        try {
          const api = window.google.search.cse.element;
          api.render({
            div: 'googleResultsHost', tag: 'searchresults-only', gname: 'vinted-results',
            attributes: { enableImageSearch: false, enableHistory: false, autoSearchOnLoad: false, linkTarget: '_blank' },
          });
          clearTimeout(timer);
          resolve(api.getElement('vinted-results'));
        } catch (error) { clearTimeout(timer); googleSearchPromise = null; reject(error); }
      },
      searchCallbacks: { web: { ready: receiveGoogleResults } },
    };
    const script = document.createElement('script');
    script.async = true;
    script.src = `https://cse.google.com/cse.js?cx=${encodeURIComponent(getSearchEngineId())}`;
    script.onerror = () => { clearTimeout(timer); googleSearchPromise = null; script.remove(); reject(new Error('Impossible de charger Google.')); };
    document.head.appendChild(script);
  });
  return googleSearchPromise;
}

function receiveGoogleResults(gname, query, promos, results, container) {
  if (gname !== 'vinted-results') return false;
  if (query !== googleQuery(state.query)) return true;
  // Google replaces its result DOM during pagination. Keep our cards outside it.
  googleResultsContainer = $('#googleCardsHost');
  container.classList.add('search-results-list');
  container.replaceChildren();
  const append = googleAppendNext;
  googleAppendNext = false;
  const seen = new Set(append ? googlePageItems.map((item) => item.id) : []);
  const incoming = results.map(RetrouveResults.fromGoogle).filter((item) => {
    if (!item || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
  googlePageItems = append ? [...googlePageItems, ...incoming] : incoming;
  if (!append) googleVisibleLimit = Math.max(availableGoogleItems().length, 1);
  if (googleRefill) {
    clearTimeout(googleRefill.timeout);
    googleRefill.busy = false;
    $('#googleResultsHost').classList.remove('is-refilling');
    // The native pagination footer is rebuilt after the ready callback returns.
    googleRefill.timer = setTimeout(loadNextGooglePage, 400);
  }
  // Migrate favorites and exclusions stored with tracking parameters or country URLs.
  for (const item of googlePageItems) {
    for (const key of state.favorites) {
      if (key.startsWith('google:') && RetrouveResults.listingUrl(key.slice(7))?.id === item.id) {
        state.favorites.delete(key); state.favorites.add(`google:${item.id}`);
      }
    }
    for (const key of Object.keys(state.googleRejected)) {
      if (RetrouveResults.listingUrl(key)?.id === item.id) {
        delete state.googleRejected[key]; state.googleRejected[item.id] = item;
      }
    }
    if (state.favorites.has(`google:${item.id}`)) savedGoogleItems[item.id] = item;
  }
  persistGoogleItems();
  document.body.classList.remove('gsc-overflow-hidden');
  applyGoogleView();
  showGoogleResults();
  if (pendingGoogleSearch?.query === query) {
    clearTimeout(pendingGoogleSearch.timer);
    pendingGoogleSearch.resolve();
    pendingGoogleSearch = null;
  }
  return true;
}

async function executeGoogleSearch(query) {
  const element = await loadGoogleSearch();
  if (query !== state.query) return;
  return new Promise((resolve, reject) => {
    const search = googleQuery(query);
    pendingGoogleSearch = { query: search, resolve, reject, timer: setTimeout(() => {
      pendingGoogleSearch = null;
      reject(new Error('Google n’a pas renvoyé de résultats. Réessaie dans un instant.'));
    }, 20000) };
    element.execute(search);
  });
}

function persistGoogleItems() {
  localStorage.setItem('retrouve-google-items', JSON.stringify(savedGoogleItems));
  persistCollections();
}

function showGoogleResults() {
  $('#loadingState').hidden = true;
  $('#listingGrid').hidden = true;
  $('#emptyState').hidden = true;
  $('#googleResultsWrap').hidden = false;
  $('#sourceNotice').classList.add('is-live');
  $('#sourceNotice').classList.remove('is-searching');
  $('.feed-panel').classList.remove('is-searching');
  $('#sourceNotice').innerHTML = `<span>Google</span><p>Photos et descriptions des annonces indexées. Le prix, la disponibilité et les informations manquantes sont à vérifier sur Vinted.</p><a href="${safeText(buildVintedSearchUrl(state.query))}" target="_blank" rel="noopener noreferrer">Rechercher sur Vinted ↗</a>`;
}

function googleCard(item) {
  const card = document.createElement('article');
  card.className = 'search-result-card';
  card.dataset.itemId = item.id;
  const isFavorite = state.favorites.has(`google:${item.id}`);
  card.innerHTML = `
    <a class="search-result-photo" href="${safeText(item.url)}" target="_blank" rel="noopener noreferrer" aria-label="Voir l’annonce : ${safeText(item.title)}"><span>Photo non disponible</span></a>
    <div class="search-result-info">
      <p class="search-result-source">Vinted · Annonce indexée</p>
      <h3><a href="${safeText(item.url)}" target="_blank" rel="noopener noreferrer">${safeText(item.title)}</a></h3>
      <p class="search-result-description">${safeText(item.description || 'Description non fournie par Google.')}</p>
      <p class="search-result-details">${item.size ? `Taille ${safeText(item.size)}` : 'Taille à vérifier sur Vinted'}</p>
      <div class="search-result-bottom"><strong>${item.price == null ? 'Prix sur Vinted' : `${item.price.toLocaleString('fr-FR')} €`}</strong><a href="${safeText(item.url)}" target="_blank" rel="noopener noreferrer">Voir l’annonce →</a></div>
    </div>
    <div class="search-result-actions"><button type="button" data-action="favorite" class="${isFavorite ? 'is-favorite' : ''}" aria-pressed="${isFavorite}" aria-label="${isFavorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}">${isFavorite ? '♥' : '♡'}</button><button type="button" data-action="dismiss" aria-label="Écarter cette annonce">×</button></div>`;
  if (item.images.length) {
    const frame = card.querySelector('.search-result-photo');
    const photo = document.createElement('img');
    photo.alt = item.title; photo.loading = 'lazy'; photo.referrerPolicy = 'no-referrer';
    let index = 0;
    photo.addEventListener('load', () => { frame.classList.add('has-photo'); });
    photo.addEventListener('error', () => {
      index += 1;
      if (index < item.images.length) photo.src = item.images[index];
      else { photo.remove(); frame.classList.remove('has-photo'); }
    });
    photo.src = item.images[index];
    frame.appendChild(photo);
  }
  card.addEventListener('click', (event) => {
    const action = event.target.closest('button[data-action]')?.dataset.action;
    if (!action) return;
    if (action === 'favorite') {
      const id = `google:${item.id}`;
      if (state.favorites.has(id)) { state.favorites.delete(id); delete savedGoogleItems[item.id]; }
      else { state.favorites.add(id); savedGoogleItems[item.id] = item; }
    } else {
      const visibleCount = Math.min(availableGoogleItems().length, googleVisibleLimit);
      state.googleRejected[item.id] = item;
      showToast('Annonce écartée — tu peux la restaurer plus tard');
      requestGoogleRefill(visibleCount);
    }
    persistGoogleItems(); applyGoogleView();
  });
  return card;
}

function applyGoogleView() {
  const favoritesView = state.view === 'favorites';
  $('#googleCardsHost').hidden = favoritesView;
  $('#googleResultsHost').hidden = favoritesView;
  const favoritesHost = $('#googleFavoritesHost');
  favoritesHost.hidden = !favoritesView;
  const container = favoritesView ? favoritesHost : googleResultsContainer;
  if (!container) return;
  let items = (favoritesView ? Object.values(savedGoogleItems).filter((item) => state.favorites.has(`google:${item.id}`)) : availableGoogleItems().slice(0, googleVisibleLimit))
    .filter((item) => !state.googleRejected[item.id]);
  if (!favoritesView && $('#photosOnly').checked) items = items.filter((item) => item.images.length);
  const sort = $('#sortSelect').value;
  const hasPrices = items.some((item) => item.price != null);
  ['price-asc', 'price-desc'].forEach((value) => { $(`#sortSelect option[value="${value}"]`).disabled = !hasPrices; });
  if (!hasPrices) $('#sortSelect').value = 'relevance';
  if (sort === 'price-asc' || sort === 'price-desc') {
    items = [...items].sort((a, b) => a.price == null ? (b.price == null ? 0 : 1) : b.price == null ? -1 : sort === 'price-asc' ? a.price - b.price : b.price - a.price);
  }
  const existingCards = new Map([...container.querySelectorAll('.search-result-card')].map((card) => [card.dataset.itemId, card]));
  container.replaceChildren(...items.map((item) => {
    const card = existingCards.get(item.id) || googleCard(item);
    const button = card.querySelector('[data-action="favorite"]');
    const favorite = state.favorites.has(`google:${item.id}`);
    button.classList.toggle('is-favorite', favorite);
    button.setAttribute('aria-pressed', String(favorite));
    button.setAttribute('aria-label', favorite ? 'Retirer des favoris' : 'Ajouter aux favoris');
    button.textContent = favorite ? '♥' : '♡';
    return card;
  }));
  if (!items.length) {
    const empty = document.createElement('p'); empty.className = 'search-results-empty';
    empty.textContent = favoritesView ? 'Aucun favori enregistré pour le moment.' : 'Aucune annonce sur cette page ne correspond aux critères connus. Essaie la page suivante ou élargis la recherche.';
    container.appendChild(empty);
  }
  $('#feedEyebrow').textContent = `${items.length} annonce${items.length > 1 ? 's' : ''} affichée${items.length > 1 ? 's' : ''}`;
  $('#feedTitle').textContent = favoritesView ? 'Tes coups de cœur' : (state.query.type ? `${state.query.type} rien que pour toi` : 'Les annonces Vinted');
}

function renderFilters() {
  const labels = { type: '', brand: '', details: '', size: 'Taille recherchée : ', maxPrice: 'Budget souhaité : ', color: '', minRating: 'Vendeur ≥ ', market: '' };
  const tags = Object.entries(state.query).filter(([key, value]) => value && !['market', 'allowUnrated'].includes(key)).map(([key, value]) => `${labels[key]}${value}${key === 'maxPrice' ? ' €' : key === 'minRating' ? ' ★' : ''}`);
  if (state.source === 'live' && state.query.allowUnrated) tags.push('Nouveaux vendeurs acceptés');
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
  stopGoogleRefill();
  googleAppendNext = false;
  googleVisibleLimit = Infinity;
  googlePageItems = [];
  $('#googleCardsHost').replaceChildren();
  if (pendingGoogleSearch) {
    clearTimeout(pendingGoogleSearch.timer);
    pendingGoogleSearch.resolve();
    pendingGoogleSearch = null;
  }
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
      if (query !== state.query) return;
      state.listings = payload.items.map((item, index) => ({ ...item, id: String(item.id ?? `live-${index}`), createdAt: item.createdAt ?? 0 })); state.source = 'live';
      $('#sourceNotice').classList.add('is-live'); $('#sourceNotice').innerHTML = '<span>En direct</span><p>Les annonces viennent de ta source connectée.</p>';
    } catch (error) {
      if (query !== state.query) return;
      state.listings = []; state.source = 'error';
      $('#sourceNotice').innerHTML = '<span>Indisponible</span><p>La source d’annonces n’a pas répondu. Réessaie la recherche.</p>';
    }
  } else if (getSearchEngineId()) {
    try {
      state.source = 'google';
      // Keep Google's verification challenge accessible while waiting for results.
      $('#googleResultsWrap').hidden = false;
      $('#googleResultsHost').hidden = false;
      $('#googleFavoritesHost').hidden = true;
      await executeGoogleSearch(query);
      if (query !== state.query) return;
      showGoogleResults();
      applyGoogleView(); renderFilters(); persistCollections();
      return;
    } catch (error) {
      if (query !== state.query) return;
      $('#sourceNotice').classList.remove('is-searching');
      $('.feed-panel').classList.remove('is-searching');
      $('#loadingState').hidden = true;
      $('#googleResultsWrap').hidden = false;
      $('#sourceNotice').innerHTML = `<span>En attente</span><p>${safeText(error.message)} Si Google affiche une vérification ci-dessous, complète-la pour continuer.</p><a href="${safeText(buildVintedSearchUrl(query))}" target="_blank" rel="noopener noreferrer">Rechercher sur Vinted ↗</a>`;
      renderFilters();
      return;
    }
  } else { state.listings = []; state.source = 'idle'; }
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
function resetSearch() {
  stopGoogleRefill();
  googleAppendNext = false;
  if (pendingGoogleSearch) {
    clearTimeout(pendingGoogleSearch.timer); pendingGoogleSearch.resolve(); pendingGoogleSearch = null;
  }
  $('#searchForm').reset(); state.query = {}; state.listings = []; state.source = 'idle';
  googlePageItems = [];
  $('#loadingState').hidden = true;
  $('.feed-panel').classList.remove('is-searching');
  $('#sourceNotice').classList.remove('is-searching');
  $('#sourceNotice').innerHTML = '<span>Prêt</span><p>Choisis tes critères et lance une nouvelle recherche.</p>';
  renderListings();
}
$('#resetFilters').addEventListener('click', resetSearch);
$('#emptyReset').addEventListener('click', resetSearch);
$('#sortSelect').addEventListener('change', () => state.source === 'google' ? applyGoogleView() : renderListings());
$('#photosOnly').addEventListener('change', () => {
  stopGoogleRefill();
  googleVisibleLimit = Math.max(availableGoogleItems().length, 1);
  applyGoogleView();
});
$$('.nav-link').forEach((button) => button.addEventListener('click', () => {
  $$('.nav-link').forEach((item) => item.classList.remove('active'));
  button.classList.add('active');
  state.view = button.dataset.view;
  if (state.view !== 'all') stopGoogleRefill();
  if (state.view === 'favorites' && Object.keys(savedGoogleItems).length) state.source = 'google';
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
  const googleItems = Object.entries(state.googleRejected).map(([key, item]) => ({ ...item, key }));
  const demoMarkup = items.map((item) => `<div class="rejected-item" data-id="${safeText(item.id)}"><img src="${safeText(item.image)}" alt="" /><span><strong>${safeText(item.title)}</strong><small>${safeText(item.brand)} · ${item.price} €</small></span><button type="button">Restaurer</button></div>`).join('');
  const googleMarkup = googleItems.map((item) => `<div class="rejected-item" data-google-url="${safeText(item.key)}"><span class="rejected-placeholder">↗</span><span><strong>${safeText(item.title)}</strong><small>Résultat Vinted intégré</small></span><button type="button">Restaurer</button></div>`).join('');
  $('#rejectedList').innerHTML = demoMarkup + googleMarkup || '<p class="modal-subtitle">Aucune annonce écartée pour l’instant.</p>';
  $('#restoreAll').hidden = !(items.length || googleItems.length);
}
$('#rejectedButton').addEventListener('click', () => { renderRejected(); rejectedDialog.showModal(); }); $('#closeRejected').addEventListener('click', () => rejectedDialog.close());
$('#rejectedList').addEventListener('click', (event) => {
  const item = event.target.closest('.rejected-item'); if (!item || !event.target.closest('button')) return;
  if (item.dataset.googleUrl) { delete state.googleRejected[item.dataset.googleUrl]; applyGoogleView(); } else { state.rejected.delete(item.dataset.id); }
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

if (!window.RETROUVE_CONFIG?.apiUrl?.trim()) {
  $('#submitLabel').textContent = getSearchEngineId() ? 'Afficher les annonces ici' : 'Configurer les résultats';
  fields.minRating.disabled = true;
  fields.allowUnrated.disabled = true;
  fields.minRating.closest('.field').title = 'Google ne fournit pas les évaluations des vendeurs.';
  $('#sellerRatingHelp').hidden = false;
  $('#maxPrice').closest('.field').querySelector('span').textContent = 'Budget souhaité';
  $('#maxPrice').title = 'Le prix est à vérifier sur Vinted lorsque Google ne le fournit pas.';
  $('#sortSelect option[value="newest"]').disabled = true;
  $('#sortSelect option[value="newest"]').textContent = 'Date non fournie';
}
readProfile(); persistCollections(); renderListings();
if (getSearchEngineId() && !window.RETROUVE_CONFIG?.apiUrl?.trim()) {
  $('#sourceNotice').innerHTML = '<span>Prêt</span><p>Le moteur est connecté. Choisis tes critères et lance la recherche.</p><button id="configureSource" type="button">Configurer</button>';
  $('#configureSource').addEventListener('click', openSourceDialog);
}
