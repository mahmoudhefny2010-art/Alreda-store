(() => {
  'use strict';

  const labels = document.querySelector('[data-admin-catalog]');
  if (!labels) return;
  const messages = {
    uploading: labels.dataset.uploading || 'Uploading images…',
    uploaded: labels.dataset.uploaded || 'Image uploaded to Cloudinary.',
    failed: labels.dataset.uploadFailed || 'Upload failed. Check Cloudinary settings and try again.',
    remove: labels.dataset.removeImage || 'Remove image',
  };

  const colorPicker = document.querySelector('[data-catalog-color-picker]');
  if (colorPicker) {
    const colorEn = colorPicker.closest('form')?.querySelector('#product-color');
    const colorAr = colorPicker.closest('form')?.querySelector('#product-color-ar');
    const choices = [...colorPicker.querySelectorAll('[data-color-choice]')];
    const list = colorPicker.querySelector('[data-color-image-list]');
    const hidden = colorPicker.querySelector('[data-color-variants]');
    const form = colorPicker.closest('form');
    const imageLabel = colorPicker.dataset.colorImageLabel || 'Product image';
    const stockLabel = colorPicker.dataset.colorStockLabel || 'Stock quantity';
    const priceLabel = colorPicker.dataset.colorPriceLabel || 'Color price (EGP, optional)';
    const offerLabel = colorPicker.dataset.colorOfferLabel || 'Offer price (EGP, optional)';
    const currentOfferLabel = colorPicker.dataset.currentOfferLabel || 'Current offer';
    let existingOffers = {};
    try { existingOffers = JSON.parse(colorPicker.dataset.existingColorOffers || '{}'); } catch { /* Optional current-offer preview. */ }
    const noImageLabel = colorPicker.dataset.noImageLabel || 'Upload a product image first';
    let selected = [];
    try { selected = JSON.parse(hidden?.value || '[]'); } catch { selected = []; }
    const currentUrls = () => (form?.querySelector('[data-image-urls]')?.value || '').split(/\r?\n/).map(url => url.trim()).filter(Boolean);
    const syncFields = () => {
      const names = selected.map(item => item.color);
      const arabic = selected.map(item => choices.find(choice => choice.dataset.colorEn === item.color)?.dataset.colorAr).filter(Boolean);
      if (colorEn) colorEn.value = names.join(', ');
      if (colorAr) colorAr.value = arabic.join(', ');
      hidden.value = JSON.stringify(selected);
      choices.forEach(choice => choice.setAttribute('aria-pressed', String(names.includes(choice.dataset.colorEn))));
    };
    function renderColorImages() {
      const urls = currentUrls();
      selected = selected.filter(item => choices.some(choice => choice.dataset.colorEn === item.color)).map(item => ({ ...item, imageUrl: urls.includes(item.imageUrl) ? item.imageUrl : (urls[0] || '') }));
      list.replaceChildren();
      for (const item of selected) {
        const choice = choices.find(button => button.dataset.colorEn === item.color);
        const row = document.createElement('div');
        row.className = 'catalog-color-image-row';
        const name = document.createElement('span');
        name.className = 'catalog-color-image-name';
        const dot = document.createElement('i');
        dot.className = 'catalog-color-dot';
        dot.style.setProperty('--swatch-color', choice?.querySelector('.catalog-color-dot')?.style.getPropertyValue('--swatch-color') || '#b9bec3');
        dot.setAttribute('aria-hidden', 'true');
        name.append(dot, document.createTextNode(choice?.textContent.trim() || item.color));
        const select = document.createElement('select');
        select.setAttribute('aria-label', `${imageLabel}: ${item.color}`);
        if (!urls.length) {
          const option = document.createElement('option'); option.value = ''; option.textContent = noImageLabel; select.append(option);
        } else urls.forEach((url, index) => {
          const option = document.createElement('option'); option.value = url; option.textContent = `${imageLabel} ${index + 1}`; option.selected = url === item.imageUrl; select.append(option);
        });
        select.addEventListener('change', () => { item.imageUrl = select.value; syncFields(); });
        const stock = document.createElement('input');
        stock.type = 'number'; stock.min = '0'; stock.max = '1000000'; stock.step = '1'; stock.value = String(item.stock ?? 0);
        stock.dataset.colorStock = '';
        stock.setAttribute('aria-label', `${stockLabel}: ${item.color}`);
        stock.addEventListener('input', () => { item.stock = Math.max(0, Math.min(1000000, Number(stock.value) || 0)); syncFields(); });
        const priceField = document.createElement('label'); priceField.className = 'catalog-color-price-field';
        const priceCaption = document.createElement('span'); priceCaption.textContent = priceLabel;
        const price = document.createElement('input');
        price.type = 'number'; price.min = '1'; price.max = '10000000'; price.step = '1'; price.value = item.priceEgp == null ? '' : String(item.priceEgp);
        price.dataset.colorPrice = ''; price.setAttribute('aria-label', `${priceLabel}: ${item.color}`);
        price.placeholder = form?.querySelector('[name="priceEgp"]')?.value || '';
        price.addEventListener('input', () => { item.priceEgp = price.value === '' ? null : Number(price.value); syncFields(); });
        priceField.append(priceCaption, price);
        const offerField = document.createElement('label'); offerField.className = 'catalog-color-offer-field';
        const offerCaption = document.createElement('span'); offerCaption.textContent = offerLabel;
        const offer = document.createElement('input'); offer.type = 'number'; offer.min = '1'; offer.max = '10000000'; offer.step = '1'; offer.value = item.salePriceEgp == null ? '' : String(item.salePriceEgp);
        offer.dataset.colorOffer = ''; offer.setAttribute('aria-label', `${offerLabel}: ${item.color}`);
        offer.addEventListener('input', () => { item.salePriceEgp = offer.value === '' ? null : Number(offer.value); syncFields(); });
        offerField.append(offerCaption, offer);
        const imageField = document.createElement('label'); imageField.className = 'catalog-color-image-field';
        imageField.append(document.createTextNode(imageLabel), select);
        const stockField = document.createElement('label'); stockField.className = 'catalog-color-stock-field';
        stockField.append(document.createTextNode(stockLabel), stock);
        const preview = document.createElement('img'); preview.className = 'catalog-color-image-preview'; preview.alt = ''; preview.hidden = !item.imageUrl; preview.src = item.imageUrl || '';
        select.addEventListener('change', () => { preview.src = select.value || ''; preview.hidden = !select.value; });
        row.append(name, preview, imageField, stockField, priceField, offerField);
        const inherited = existingOffers[item.color] ?? colorPicker.dataset.colorProductOffer;
        if (inherited) { const hint = document.createElement('small'); hint.className = 'catalog-color-current-offer'; hint.textContent = `${currentOfferLabel}: EGP ${inherited}`; row.append(hint); }
        list.append(row);
      }
      syncFields();
    }
    choices.forEach(choice => choice.addEventListener('click', () => {
      const index = selected.findIndex(item => item.color === choice.dataset.colorEn);
      if (index >= 0) selected.splice(index, 1);
      else selected.push({ color: choice.dataset.colorEn, imageUrl: currentUrls()[0] || '', stock: selected.length ? 0 : (Number(form?.querySelector('[name="stock"]')?.value) || 0) });
      renderColorImages();
    }));
    form?.addEventListener('submit', event => {
      syncFields();
      if (selected.some(item => !currentUrls().includes(item.imageUrl))) {
        event.preventDefault();
        const status = form.querySelector('[data-upload-status]');
        if (status) status.textContent = noImageLabel;
        colorPicker.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });
    form?.addEventListener('catalog:images-changed', renderColorImages);
    form?.querySelector('[name="priceEgp"]')?.addEventListener('input', event => {
      list.querySelectorAll('[data-color-price]').forEach(input => { input.placeholder = event.target.value; });
    });
    syncFields();
    renderColorImages();
  }

  function renderPreviews(form, urls) {
    const preview = form.querySelector('[data-image-previews]');
    if (!preview) return;
    preview.replaceChildren();
    for (const url of urls) {
      const figure = document.createElement('figure');
      const image = document.createElement('img');
      image.src = url;
      image.alt = '';
      image.loading = 'lazy';
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.dataset.removeImage = '';
      remove.setAttribute('aria-label', messages.remove);
      remove.textContent = '×';
      figure.append(image, remove);
      preview.append(figure);
    }
  }

  function imageUrls(form) {
    if (form.dataset.kind === 'category') {
      const value = form.querySelector('[data-category-image-url]')?.value || form.querySelector('[data-category-url-fallback]')?.value || '';
      return value ? [value] : [];
    }
    const value = form.querySelector('[data-image-urls]')?.value || form.querySelector('[data-image-urls-fallback]')?.value || '';
    return value.split(/\r?\n/).map(url => url.trim()).filter(Boolean);
  }

  function saveUrls(form, urls) {
    if (form.dataset.kind === 'category') {
      const hidden = form.querySelector('[data-category-image-url]');
      const fallback = form.querySelector('[data-category-url-fallback]');
      if (hidden) hidden.value = urls[0] || '';
      if (fallback) fallback.value = urls[0] || '';
    } else {
      const value = urls.join('\n');
      const hidden = form.querySelector('[data-image-urls]');
      const fallback = form.querySelector('[data-image-urls-fallback]');
      if (hidden) hidden.value = value;
      if (fallback) fallback.value = value;
    }
    renderPreviews(form, urls);
    form.dispatchEvent(new CustomEvent('catalog:images-changed'));
  }

  document.querySelectorAll('[data-image-upload]').forEach(form => {
    const fileInput = form.querySelector('[data-image-files]');
    const status = form.querySelector('[data-upload-status]');
    const kind = form.dataset.kind;
    const initial = imageUrls(form);
    renderPreviews(form, initial);
    if (!fileInput) return;
    fileInput.addEventListener('change', async () => {
      const files = [...(fileInput.files || [])];
      if (!files.length) return;
      if (kind === 'category' && files.length !== 1) {
        status.textContent = 'Choose one category image.';
        fileInput.value = '';
        return;
      }
      const button = form.querySelector('button[type="submit"]');
      fileInput.disabled = true;
      if (button) button.disabled = true;
      status.textContent = messages.uploading;
      try {
        const body = new FormData();
        body.append('kind', kind);
        const slug = form.querySelector('[data-category-slug]')?.value.trim() || '';
        const id = form.querySelector('[name="id"]')?.value || (kind === 'category' ? slug : crypto.randomUUID());
        body.append('entityId', id);
        if (slug) body.append('slug', slug);
        const name = form.querySelector('[name="name"]')?.value.trim() || '';
        body.append('altText', name);
        for (const file of files) body.append('images', file, file.name);
        const response = await fetch('/api/admin/catalog/images', { method: 'POST', credentials: 'same-origin', body, headers: { Accept: 'application/json' } });
        const result = await response.json();
        if (!response.ok || !Array.isArray(result.images) || result.images.length !== files.length) throw new Error('UPLOAD_FAILED');
        const urls = kind === 'category' ? [result.images[0].secureUrl] : [...imageUrls(form), ...result.images.map(image => image.secureUrl)];
        saveUrls(form, urls);
        status.textContent = messages.uploaded;
      } catch {
        status.textContent = messages.failed;
      } finally {
        fileInput.disabled = false;
        fileInput.value = '';
        if (button) button.disabled = false;
      }
    });

    form.addEventListener('click', event => {
      const remove = event.target.closest('[data-remove-image]');
      if (!remove) return;
      const figure = remove.closest('figure');
      const url = figure?.querySelector('img')?.src;
      saveUrls(form, imageUrls(form).filter(candidate => new URL(candidate, location.href).href !== url));
    });
    const fallback = form.querySelector('[data-image-urls-fallback]');
    fallback?.addEventListener('input', () => saveUrls(form, fallback.value.split(/\r?\n/).map(url => url.trim()).filter(Boolean)));
    const categoryFallback = form.querySelector('[data-category-url-fallback]');
    categoryFallback?.addEventListener('input', () => saveUrls(form, categoryFallback.value ? [categoryFallback.value] : []));
  });

  document.querySelectorAll('[data-rich-editor]').forEach(editor => {
    const surface = editor.querySelector('[data-rich-surface]');
    const value = editor.querySelector('[data-rich-value]');
    if (!surface || !value) return;
    const sync = () => { value.value = surface.innerHTML; };
    surface.addEventListener('input', sync);
    editor.querySelectorAll('[data-command]').forEach(button => button.addEventListener('mousedown', event => event.preventDefault()));
    editor.querySelectorAll('[data-command]').forEach(button => button.addEventListener('click', () => {
      surface.focus();
      const command = button.dataset.command;
      document.execCommand(command, false, button.dataset.value || null);
      sync();
    }));
    editor.closest('form')?.addEventListener('submit', sync);
  });
})();
