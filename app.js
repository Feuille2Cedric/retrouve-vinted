const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const DEMO_LISTINGS = [
  { id: 'demo-1', brand: 'Nike', title: 'Air Max 90 blanc cassé et vert', size: '38', price: 54, country: 'France', condition: 'Très bon état', sellerRating: 4.9, reviewCount: 47, image: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=700&q=80', type: 'Baskets', color: 'vert', createdAt: 12 },
  { id: 'demo-2', brand: 'Sézane', title: 'Veste de travail Will écrue', size: 'M', price: 72, country: 'France', condition: 'Bon état', sellerRating: 4.6, reviewCount: 18, image: 'https://images.unsplash.com/photo-1551028719-00167b16eac5?auto=format&fit=crop&w=700&q=80', type: 'Veste', color: 'écru', createdAt: 10 },
  { id: 'demo-3', brand: 'New Balance', title: 'Baskets 530 argent et marine', size: '39', price: 68, country: 'Belgique', condition: 'Très bon état', sellerRating: null, reviewCount: 0, image: 'https://images.unsplash.com/photo-1539185441755-769473a23570?auto=format&fit=crop&w=700&q=80', type: 'Baskets', color: 'gris', createdAt: 11 },
  { id: 'demo-4', brand: 'Carhartt', title: 'Veste Detroit vintage marron', size: 'L', price: 95, country: 'France', condition: 'Bon état', sellerRating: 4.2, reviewCount: 9, image: 'https://images.unsplash.com/photo-1591047139829-d91aecb6caea?auto=format&fit=crop&w=700&q=80', type: 'Veste', color: 'marron', createdAt: 8 },
  { id: 'demo-5', brand: 'Adidas', title: 'Samba OG cuir blanc', size: '40', price: 61, country: 'Italie', condition: 'Très bon état', sellerRating: 3.8, reviewCount: 5, image: 'https://images.unsplash.com/photo-1518002171953-a080ee817e1f?auto=format&fit=crop&w=700&q=80', type: 'Baskets', color: 'blanc', createdAt: 9 },
  { id: 'demo-6', brand: 'Arket', title: 'Pull col rond laine mérinos', size: 'S', price: 39, country: 'France', condition: 'Très bon état', sellerRating: 5, reviewCount: 124, image: 'https://images.unsplash.com/photo-1576566588028-4147f3842f27?auto=format&fit=crop&w=700&q=80', type: 'Pull', color: 'bleu marine', createdAt: 6 },
  { id: 'demo-7', brand: 'Levi’s', title: 'Jean 501 coupe droite vintage', size: '38', price: 32, country: 'Pays-Bas', condition: 'Bon état', sellerRating: null, reviewCount: 0, image: 'https://images.unsplash.com/photo-1542272604-787c3835535d?auto=format&fit=crop&w=700&q=80', type: 'Jean', color: 'bleu', createdAt: 7 },
  { id: 'demo-8', brand: 'COS', title: 'Manteau long en laine mélangée', size: 'M', price: 84, country: 'Belgique', condition: 'Très bon état', sellerRating: 4.8, reviewCount: 31, image: 'https://images.unsplash.com/photo-1539533018447-63fcce2678e3?auto=format&fit=crop&w=700&q=80', type: 'Manteau', color: 'beige', createdAt: 4 },
  { id: 'demo-9', brand: 'Converse', title: 'Chuck 70 montantes noires', size: '42', price: 45, country: 'France', condition: 'Bon état', sellerRating: 2.7, reviewCount: 3, image: 'https://images.unsplash.com/photo-1494496195158-c3becb4f2475?auto=format&fit=crop&w=700&q=80', type: 'Baskets', color: 'noir', createdAt: 5 },
];

const state = {
  listings: [...DEMO_LISTINGS],
  rejected: new Set(JSON.parse(localStorage.getItem('retrouve-rejected') || '[]')),
  favorites: new Set(JSON.parse(localStorage.getItem('retrouve-favorites') || '[]')),
  googleRejected: JSON.parse(localStorage.getItem('retrouve-google-rejected') || '{}'),
  view: 'all', source: 'demo', query: {},
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
function loadGoogleSearch() {
  if (googleSearchPromise) return googleSearchPromise;
  const engineId = getSearchEngineId();
  googleSearchPromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Google Search timeout')), 15000);
    window.__gcse = {
      parsetags: 'explicit',
      initializationCallback() {
        clearTimeout(timeout);
        try {
          window.google.search.cse.element.render({ div: 'googleResultsHost', tag: 'searchresults-only', gname: 'vinted-results', attributes: { linkTarget: '_blank' } });
          observeGoogleResults();
          resolve();
        } catch (error) { reject(error); }
      },
    };
    const script = document.createElement('script');
    script.async = true;
    script.src = `https://cse.google.com/cse.js?cx=${encodeURIComponent(engineId)}`;
    script.onerror = () => { clearTimeout(timeout); reject(new Error('Google Search unavailable')); };
    document.head.appendChild(script);
  });
  return googleSearchPromise;
}

function googleQuery(query) {
  const domain = `www.vinted.${query.market || 'fr'}`;
  return [query.brand, query.details, query.type, query.color, query.size && `taille ${query.size}`, `site:${domain}/items/`].filter(Boolean).join(' ');
}

async function executeGoogleSearch(query) {
  await loadGoogleSearch();
  const element = window.google?.search?.cse?.element?.getElement('vinted-results');
  if (!element) throw new Error('Search element missing');
  element.execute(googleQuery(query));
}

function decorateGoogleResults() {
  $$('#googleResultsHost .gsc-webResult.gsc-result').forEach((result) => {
    const link = result.querySelector('a.gs-title');
    if (!link?.href) return;
    const url = link.href;
    if (state.googleRejected[url]) { result.hidden = true; return; }
    result.hidden = false;
    if (result.querySelector('.google-dismiss')) return;
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'google-dismiss'; button.textContent = '×'; button.title = 'Écarter cette annonce'; button.setAttribute('aria-label', 'Écarter cette annonce');
    button.addEventListener('click', () => {
      state.googleRejected[url] = { title: link.textContent.trim(), url };
      result.hidden = true; persistCollections(); showToast('Annonce écartée — tu peux la restaurer plus tard');
    });
    result.appendChild(button);
  });
}

function observeGoogleResults() {
  const host = $('#googleResultsHost');
  new MutationObserver(decorateGoogleResults).observe(host, { childList: true, subtree: true });
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
  state.query = query; $('#listingGrid').hidden = true; $('#loadingState').hidden = false;
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
      $('#sourceNotice').innerHTML = '<span>Intégré</span><p>Les annonces Vinted indexées par Google sont affichées sur cette page. La note vendeur reste disponible uniquement avec une API dédiée.</p>';
      renderFilters(); persistCollections();
      return;
    } catch (error) {
      showToast('Le moteur intégré n’a pas pu charger. Vérifie son identifiant.');
      state.listings = [...DEMO_LISTINGS]; state.source = 'demo';
    }
  } else { await new Promise((resolve) => setTimeout(resolve, 450)); state.listings = [...DEMO_LISTINGS]; state.source = 'demo'; }
  $('#loadingState').hidden = true; $('#listingGrid').hidden = false; renderListings();
}

$('#searchForm').addEventListener('submit', (event) => {
  event.preventDefault();
  if (!event.currentTarget.reportValidity()) return;
  const query = getQuery();
  const vintedUrl = buildVintedSearchUrl(query);
  const vintedWindow = window.open(vintedUrl, '_blank');
  if (vintedWindow) vintedWindow.opener = null;
  else window.location.assign(vintedUrl);
  showToast('Recherche ouverte directement sur Vinted');
});
$('#resetFilters').addEventListener('click', () => { $('#searchForm').reset(); state.query = {}; state.listings = [...DEMO_LISTINGS]; renderListings(); });
$('#emptyReset').addEventListener('click', () => { state.query = {}; $('#searchForm').reset(); renderListings(); });
$('#sortSelect').addEventListener('change', renderListings);
$$('.nav-link').forEach((button) => button.addEventListener('click', () => { $$('.nav-link').forEach((item) => item.classList.remove('active')); button.classList.add('active'); state.view = button.dataset.view; renderListings(); }));

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
  state.rejected.clear(); state.googleRejected = {}; $$('#googleResultsHost .gsc-webResult.gsc-result').forEach((item) => { item.hidden = false; });
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

$('#submitLabel').textContent = 'Rechercher sur Vinted';
readProfile(); persistCollections(); renderListings();
