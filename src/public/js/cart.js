'use strict';

(() => {
  const dialog = document.querySelector('[data-cart-dialog]');
  if (!dialog) return;
  const list = dialog.querySelector('[data-cart-items]');
  const status = dialog.querySelector('[data-cart-status]');
  const total = dialog.querySelector('[data-cart-total]');
  const bagButton = document.querySelector('[data-dialog="bag-dialog"]');
  const badge = document.querySelector('[data-cart-count]');
  const feedback = document.querySelector('[data-cart-feedback]');
  let feedbackTimer;
  let revision = 0;
  const locale = document.documentElement.lang || 'en';
  const price = value => new Intl.NumberFormat(locale === 'ar' ? 'ar-EG' : 'en-EG', { style: 'currency', currency: 'EGP' }).format(value);

  function added(holder) {
    if (!feedback) return;
    clearTimeout(feedbackTimer);
    const note = holder?.querySelector('[data-cart-status]');
    if (note) note.insertAdjacentElement('afterend', feedback);
    else if (holder) holder.append(feedback);
    feedback.querySelector('[data-cart-feedback-text]').textContent = dialog.dataset.addedText;
    feedback.hidden = false;
    feedbackTimer = setTimeout(() => { feedback.hidden = true; }, 3500);
  }

  async function request(url, options = {}) {
    const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', ...options,
      headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'CART_UNAVAILABLE');
    return data;
  }

  function render(cart) {
    revision++;
    list.replaceChildren();
    let subtotal = 0;
    let count = 0;
    for (const item of cart.cart_items || []) {
      const product = item.products;
      const itemPrice = product.sale_price_egp ?? product.price_egp;
      subtotal += itemPrice * item.quantity;
      count += item.quantity;
      const row = document.createElement('li');
      row.className = 'bag-item';
      const photo = document.createElement('div'); photo.className = 'bag-item-photo'; photo.setAttribute('aria-hidden', 'true');
      if (product.image_url) {
        try {
          const url = new URL(product.image_url, window.location.origin);
          if (['https:', 'http:'].includes(url.protocol)) {
            const image = document.createElement('img'); image.className = 'bag-item-photo'; image.src = url.href; image.alt = ''; image.loading = 'lazy';
            image.addEventListener('error', () => image.remove(), { once: true }); photo.append(image);
          }
        } catch { /* Keep the neutral image frame when an image URL is invalid. */ }
      }
      const details = document.createElement('div'); details.className = 'bag-item-details';
      const name = document.createElement('span');
      name.className = 'bag-item-name';
      name.textContent = locale === 'ar' ? product.name_ar || product.name : product.name;
      const quantity = document.createElement('span'); quantity.className = 'bag-item-quantity';
      quantity.textContent = `${item.quantity} × ${price(itemPrice)}`;
      const lineTotal = document.createElement('span'); lineTotal.className = 'bag-item-price'; lineTotal.textContent = price(itemPrice * item.quantity);
      const remove = document.createElement('button');
      remove.type = 'button'; remove.className = 'bag-remove'; remove.textContent = dialog.dataset.removeText;
      remove.setAttribute('aria-label', `${dialog.dataset.removeText}: ${name.textContent}`);
      remove.addEventListener('click', async () => {
        remove.disabled = true; revision++;
        try { render(await request('/api/cart/items', { method: 'DELETE', body: JSON.stringify({ productId: product.id, ...(item.variant_id ? { variantId: item.variant_id } : {}) }) })); }
        catch { status.textContent = dialog.dataset.errorText; }
        finally { remove.disabled = false; }
      });
      details.append(name, quantity, remove); row.append(photo, details, lineTotal); list.append(row);
    }
    if (badge) {
      badge.textContent = count > 99 ? '99+' : String(count); badge.hidden = count === 0;
      bagButton?.setAttribute('aria-label', count ? `${bagButton.dataset.bagLabel}: ${new Intl.NumberFormat(locale).format(count)}` : bagButton.dataset.bagLabel);
    }
    status.textContent = cart.cart_items?.length ? '' : dialog.dataset.emptyText;
    total.replaceChildren();
    if (count) { const label = document.createElement('span'); label.textContent = dialog.dataset.totalText; const amount = document.createElement('strong'); amount.textContent = price(subtotal); total.append(label, amount); }
    const checkout = dialog.querySelector('[data-cart-checkout]');
    if (checkout) checkout.hidden = count === 0;
  }

  async function refresh() {
    const started = revision;
    try { const cart = await request('/api/cart'); if (started === revision) render(cart); }
    catch { if (started === revision) status.textContent = dialog.dataset.errorText; }
  }

  document.querySelectorAll('.add-to-cart[data-product-id]').forEach(button => {
    button.addEventListener('click', async () => {
      button.disabled = true;
      revision++;
      if (feedback) feedback.hidden = true;
      const holder = button.closest('.product-card, [data-product-details]');
      const note = holder?.querySelector('[data-cart-status]');
      try {
        const quantity = Number(holder?.querySelector('#product-quantity')?.value || 1);
        const variantId = holder?.dataset.purchaseVariant || button.dataset.variantId;
        const cart = await request('/api/cart/items', { method: 'POST', body: JSON.stringify({ productId: button.dataset.productId, quantity, ...(variantId ? { variantId } : {}) }) });
        if (note) note.textContent = feedback ? '' : dialog.dataset.addedText;
        render(cart);
        added(holder);
        if (button.hasAttribute('data-buy-now')) window.location.assign(dialog.querySelector('[data-cart-checkout]').getAttribute('href'));
      } catch (error) {
        if (note) note.textContent = ['PRODUCT_UNAVAILABLE', 'INSUFFICIENT_INVENTORY', 'PRODUCT_OPTIONS_NOT_SUPPORTED'].includes(error.message) ? dialog.dataset.unavailableText : dialog.dataset.errorText;
      } finally { button.disabled = false; }
    });
  });

  bagButton?.addEventListener('click', refresh);
  document.addEventListener('cart:refresh', refresh);
  if (badge) refresh();
  window.addEventListener('pageshow', event => { if (event.persisted && badge) refresh(); });
})();
