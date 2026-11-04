'use strict';

(() => {
  const STORE_KEY = 'alreda:wishlist:v1';
  const root = document.querySelector('[data-wishlist]');
  const nav = document.querySelector('.mobile-bottom-nav');
  const status = root?.querySelector('[data-wishlist-status]');
  const globalStatus = document.querySelector('[data-wishlist-global-status]');
  const grid = root?.querySelector('[data-wishlist-grid]');
  const empty = root?.querySelector('[data-wishlist-empty]');
  const backLink = root?.querySelector('[data-wishlist-back]');
  const returnKey = 'alreda:wishlist-return';
  let savedReturn = '';
  let ids = new Set();
  let busy = false;
  let wishlistSignature = null;
  let refreshing = false;
  let lastRefreshAt = 0;
  const refreshInterval = 5 * 60 * 1000;
  let databaseWishlistAvailable = nav?.dataset.authenticated === 'true';

  if (root) {
    try { savedReturn = sessionStorage.getItem(returnKey) || ''; sessionStorage.removeItem(returnKey); } catch { /* Navigation still falls back to the catalog. */ }
  } else {
    document.addEventListener('click', event => {
      const link = event.target.closest('a[href]');
      if (!link || link.target === '_blank') return;
      try {
        const destination = new URL(link.href, window.location.href);
        if (destination.origin === window.location.origin && destination.pathname.replace(/\/$/, '') === '/wishlist') {
          sessionStorage.setItem(returnKey, window.location.href);
        }
      } catch { /* A missing session store does not block navigation. */ }
    });
  }

  backLink?.addEventListener('click', event => {
    let destination;
    try { destination = new URL(savedReturn || document.referrer); } catch { return; }
    if (destination.origin !== window.location.origin || destination.pathname.replace(/\/$/, '') === '/wishlist') return;
    event.preventDefault();
    const referrerMatches = document.referrer === destination.href;
    if (referrerMatches && window.history.length > 1) window.history.back();
    else window.location.replace(`${destination.pathname}${destination.search}${destination.hash}`);
  });

  function readGuest() {
    try {
      const value = JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
      return Array.isArray(value) ? [...new Set(value.filter(id => typeof id === 'string' && /^[\p{L}\p{N}_-]{1,80}$/u.test(id)))].slice(0, 100) : [];
    } catch { return []; }
  }
  function writeGuest(values) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify([...new Set(values)].slice(0, 100))); } catch { /* Storage can be unavailable in private browsing. */ }
  }
  async function request(url, options = {}) {
    const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', ...options,
      headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'WISHLIST_UNAVAILABLE');
    return data;
  }
  function paintCounts() {
    const count = ids.size;
    document.querySelectorAll('[data-wishlist-count]').forEach(badge => {
      badge.textContent = count > 99 ? '99+' : String(count);
      badge.hidden = count === 0;
    });
    document.querySelectorAll('[data-favorite-toggle]').forEach(button => {
      const saved = ids.has(button.dataset.productId);
      button.setAttribute('aria-pressed', String(saved));
      button.setAttribute('aria-label', saved ? button.dataset.removeLabel : button.dataset.saveLabel);
      button.classList.toggle('is-saved', saved);
    });
  }
  function announce(message) { if (status) status.textContent = message; if (globalStatus) globalStatus.textContent = message; }
  function clearLoadError() {
    if (status?.textContent === root?.dataset.error) status.textContent = '';
    if (globalStatus?.textContent === root?.dataset.error) globalStatus.textContent = '';
  }
  function storeIds(next) { ids = new Set(next); paintCounts(); }
  async function loadIds() {
    const guest = readGuest();
    if (nav?.dataset.authenticated === 'true') {
      try {
        if (guest.length) {
          const merged = await request('/api/wishlist/merge', { method: 'POST', body: JSON.stringify({ identifiers: guest }) });
          localStorage.removeItem(STORE_KEY);
          storeIds(merged.ids || []);
        } else if (!root) {
          // The wishlist page already gets IDs with its item response. Other
          // signed-in pages need this small read to restore the saved hearts.
          const saved = await request('/api/wishlist/ids');
          storeIds(saved.ids || []);
        }
      } catch {
        databaseWishlistAvailable = false;
        storeIds(guest);
        announce(root?.dataset.error || nav?.dataset.favoriteError);
      }
    } else storeIds(guest);
  }

  async function toggle(button) {
    if (busy) return;
    busy = true;
    const id = button.dataset.productId;
    const wasSaved = ids.has(id);
    button.disabled = true;
    try {
      const saveLocally = () => {
        const next = new Set(readGuest());
        if (wasSaved) next.delete(id); else if (next.size < 100) next.add(id);
        writeGuest([...next]); storeIds(next);
      };
      if (nav?.dataset.authenticated === 'true' && databaseWishlistAvailable) {
        const result = wasSaved
          ? await request(`/api/wishlist/items/${encodeURIComponent(id)}`, { method: 'DELETE' })
          : await request('/api/wishlist/items', { method: 'POST', body: JSON.stringify({ productId: id }) });
        storeIds(result.ids || []);
      } else {
        saveLocally();
      }
      if (root?.contains(button)) await renderWishlist();
      announce(wasSaved ? button.dataset.removedMessage : button.dataset.addedMessage);
    } catch (error) {
      if (error.message === 'WISHLIST_UNAVAILABLE' && nav?.dataset.authenticated === 'true') {
        databaseWishlistAvailable = false;
        const next = new Set(readGuest());
        if (wasSaved) next.delete(id); else if (next.size < 100) next.add(id);
        writeGuest([...next]); storeIds(next);
        if (root?.contains(button)) await renderWishlist();
        announce(wasSaved ? button.dataset.removedMessage : button.dataset.addedMessage);
      } else announce(root?.dataset.error || nav?.dataset.favoriteError || 'Favorites could not be updated.');
    }
    finally { button.disabled = false; busy = false; }
  }

  document.addEventListener('click', event => {
    const button = event.target.closest('[data-favorite-toggle]');
    if (!button) return;
    event.preventDefault(); event.stopPropagation();
    toggle(button);
  });

  document.querySelectorAll('[data-favorite-toggle]').forEach(button => {
    button.dataset.saveLabel ||= button.getAttribute('aria-label') || '';
    button.dataset.removeLabel ||= nav?.dataset.favoriteRemoveLabel || 'Remove from favorites';
    button.dataset.addedMessage ||= nav?.dataset.favoriteAdded || 'Added to favorites.';
    button.dataset.removedMessage ||= nav?.dataset.favoriteRemoved || 'Removed from favorites.';
  });

  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }
  function moneyText(value) { return value || root.dataset.priceLabel; }
  async function addToCart(item, card, button, select) {
    if (item.unavailable || item.outOfStock) return;
    const variantId = select ? select.value : item.selectedVariantId;
    if (item.hasOptions && !variantId) { announce(root.dataset.choose); select?.focus(); return; }
    button.disabled = true;
    try {
      const input = { productId: item.productId, quantity: 1, ...(variantId ? { variantId } : {}) };
      const cart = window.AlredaCart
        ? await window.AlredaCart.add(input)
        : await request('/api/cart/items', { method: 'POST', body: JSON.stringify(input) });
      document.dispatchEvent(new CustomEvent('cart:refresh', { detail: cart }));
      announce(root.dataset.added);
      button.textContent = root.dataset.added;
      window.setTimeout(() => { if (button.isConnected) { button.textContent = root.dataset.add; button.disabled = false; } }, 1800);
    } catch (error) {
      announce(error.message === 'INSUFFICIENT_INVENTORY' ? root.dataset.outOfStock : root.dataset.unavailable);
      button.disabled = false;
    }
  }
  function productCard(item) {
    const card = node('article', 'wishlist-card');
    if (item.unavailable) {
      card.append(node('div', 'wishlist-unavailable-image', String.fromCharCode(0x2661)), node('h2', 'wishlist-card-title', root.dataset.unavailable), node('p', 'wishlist-unavailable-copy', root.dataset.unavailable));
    } else {
      const link = node('a', 'wishlist-card-image'); link.href = item.href; link.setAttribute('aria-label', item.name);
      let imageElement = null;
      if (item.image) { imageElement = node('img'); imageElement.src = item.image; imageElement.alt = item.name; imageElement.loading = 'lazy'; imageElement.width = 480; imageElement.height = 480; link.append(imageElement); }
      else link.append(node('span', 'wishlist-unavailable-image', String.fromCharCode(0x2661)));
      const info = node('div', 'wishlist-card-info');
      const title = node('a', 'wishlist-card-title', item.name); title.href = item.href;
      const price = node('div', 'wishlist-card-price'); price.append(node('strong', '', moneyText(item.price)));
      if (item.compareAt) price.append(node('del', '', item.compareAt));
      const available = node('p', `wishlist-stock${item.outOfStock ? ' is-unavailable' : ''}`, item.status);
      const select = item.hasOptions ? node('select', 'wishlist-variant') : null;
      if (select) {
        select.setAttribute('aria-label', root.dataset.choose);
        select.append(new Option(root.dataset.choose, ''));
        item.variants.forEach(variant => {
          const option = new Option(`${variant.title} \u00b7 ${variant.price}${variant.available ? '' : ` \u00b7 ${root.dataset.outOfStock}`}`, variant.id);
          option.disabled = !variant.available || !variant.id;
          select.append(option);
        });
        select.addEventListener('change', () => {
          const current = item.variants.find(value => value.id === select.value);
          if (current) { price.replaceChildren(node('strong', '', current.price)); if (current.compareAt) price.append(node('del', '', current.compareAt)); if (current.image && imageElement) imageElement.src = current.image; }
        });
      }
      const actions = node('div', 'wishlist-card-actions');
      const add = node('button', 'button wishlist-add', root.dataset.add); add.type = 'button'; add.disabled = item.outOfStock;
      add.addEventListener('click', () => addToCart(item, card, add, select));
      info.append(title, price, available);
      if (select) info.append(select);
      actions.append(add); info.append(actions); card.append(link, info);
    }
    const remove = node('button', 'text-link wishlist-remove', root.dataset.remove); remove.type = 'button';
    remove.addEventListener('click', async () => {
      remove.disabled = true;
      if (nav?.dataset.authenticated === 'true' && databaseWishlistAvailable) {
        try { const result = await request(`/api/wishlist/items/${encodeURIComponent(item.id)}`, { method: 'DELETE' }); storeIds(result.ids || []); await renderWishlist(); }
        catch { remove.disabled = false; announce(root.dataset.error); }
      } else { const next = new Set(readGuest()); next.delete(item.id); writeGuest([...next]); storeIds(next); await renderWishlist(); }
    });
    card.append(remove);
    return card;
  }
  async function renderWishlist() {
    if (!root || !grid) return;
    const values = [...ids];
    try {
      const url = nav?.dataset.authenticated === 'true' && databaseWishlistAvailable ? '/api/wishlist' : `/api/wishlist?${nav?.dataset.authenticated === 'true' ? 'local=1&' : ''}ids=${encodeURIComponent(values.join(','))}`;
      const data = await request(url);
      clearLoadError();
      if (data.authenticated && Array.isArray(data.ids)) storeIds(data.ids);
      const signature = JSON.stringify(data.items);
      if (signature === wishlistSignature) { lastRefreshAt = Date.now(); return; }
      const hadSnapshot = wishlistSignature !== null;
      wishlistSignature = signature;
      if (!data.items.length) {
        grid.replaceChildren();
        empty.hidden = false;
        root.querySelector('[data-empty-heading]').textContent = root.dataset.emptyTitle;
        root.querySelector('[data-empty-message]').textContent = root.dataset.emptyCopy;
        lastRefreshAt = Date.now();
        return;
      }
      empty.hidden = true;
      grid.replaceChildren(...data.items.map(productCard));
      paintCounts();
      if (hadSnapshot) announce(root.dataset.updated);
      lastRefreshAt = Date.now();
    } catch {
      if (nav?.dataset.authenticated === 'true' && databaseWishlistAvailable) {
        databaseWishlistAvailable = false;
        storeIds(readGuest());
      }
      announce(root.dataset.error);
    }
  }

  async function refreshWishlist() {
    if (!root || refreshing || document.hidden) return;
    refreshing = true;
    try { await loadIds(); await renderWishlist(); }
    finally { refreshing = false; }
  }
  function refreshIfDue() {
    if (!document.hidden && Date.now() - lastRefreshAt >= refreshInterval) refreshWishlist();
  }

  loadIds().then(renderWishlist);
  document.addEventListener('wishlist:refresh', () => loadIds().then(renderWishlist));
  if (root) {
    window.setInterval(refreshIfDue, refreshInterval);
    document.addEventListener('visibilitychange', refreshIfDue);
    window.addEventListener('focus', refreshIfDue);
    window.addEventListener('pageshow', event => { if (event.persisted) refreshWishlist(); });
  }
  const viewport = window.visualViewport;
  if (viewport && nav) {
    const updateKeyboardState = () => nav.classList.toggle('keyboard-open', window.innerHeight - viewport.height > 150);
    viewport.addEventListener('resize', updateKeyboardState);
    updateKeyboardState();
  }
})();
