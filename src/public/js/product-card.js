(() => {
  const states = new WeakMap();
  const hover = matchMedia('(hover: hover) and (pointer: fine)');
  function state(card) {
    if (states.has(card)) return states.get(card);
    let data;
    try { data = JSON.parse(card.dataset.cardPreview); } catch { return null; }
    const image = card.querySelector('.product-card-link img');
    if (!image || !data.variants?.length) return null;
    const value = { data, image, selected: data.variants[0], original: image.getAttribute('src'), displayImage: !hover.matches && data.mobileImage ? data.mobileImage : image.getAttribute('src'), hovered: false, revision: 0 };
    states.set(card, value); return value;
  }
  function show(value, src) {
    const revision = ++value.revision;
    if (!src || (value.image.getAttribute('src') === src && !value.image.closest('picture')?.querySelector('source'))) { value.image.removeAttribute('aria-busy'); return; }
    // Swap only after decoding: keep the current photo if the next image cannot load.
    const preload = new Image(); value.image.setAttribute('aria-busy', 'true'); preload.src = src;
    preload.decode().then(() => { if (revision === value.revision) { value.image.closest('picture')?.querySelectorAll('source').forEach(source => source.remove()); value.image.src = src; } }).catch(() => {}).finally(() => { if (revision === value.revision) value.image.removeAttribute('aria-busy'); });
  }
  function selectOption(button) {
    const card = button?.closest('[data-card-preview]'); if (!card) return;
    const value = state(card); if (!value) return;
    const index = Number(button.dataset.optionIndex), option = button.dataset.optionValue;
    // Keep other selections wherever that combination exists; otherwise choose
    // the closest real variant and visibly update every affected option.
    const candidates = value.data.variants.filter(variant => variant.options[index] === option);
    const score = variant => variant.options.reduce((sum, option, i) => sum + (i !== index && option === value.selected.options[i] ? 1 : 0), 0);
    const selected = candidates.sort((a, b) => score(b) - score(a))[0]; if (!selected) return;
    value.selected = selected; value.displayImage = value.data.colorImages?.[option] || selected.image || value.original; show(value, value.displayImage);
    card.querySelectorAll('.card-option').forEach(option => option.setAttribute('aria-pressed', String(selected.options[Number(option.dataset.optionIndex)] === option.dataset.optionValue)));
    card.querySelectorAll('.product-card-link[href], .product-card-title[href], .card-choose-options[href]').forEach(link => { const url = new URL(link.href); url.searchParams.set('variant', selected.id); link.href = url.pathname + url.search; });
    const price = card.querySelector('.product-price');
    if (price) { price.replaceChildren(); const current = document.createElement('span'); current.textContent = selected.price; price.append(current); if (selected.compare) { const old = document.createElement('del'); old.textContent = selected.compare; price.append(' ', old); } }
    const availability = card.querySelector('.availability'); if (availability) { availability.setAttribute('aria-live', 'polite'); availability.textContent = selected.availability; if (availability.hasAttribute('data-card-stock')) availability.hidden = !selected.outOfStock; }
  }
  document.addEventListener('click', event => { const button = event.target.closest('.card-option'); if (button) selectOption(button); });
  document.addEventListener('pointerover', event => {
    if (!hover.matches || event.pointerType === 'touch') return;
    const media = event.target.closest('.product-card-link');
    const card = media?.closest('[data-card-preview]'); if (!card || media.contains(event.relatedTarget)) return;
    const value = state(card); if (!value) return;
    value.hovered = true;
    if (value.data.hoverImage || value.data.gallery.length > 1) show(value, value.data.hoverImage || value.data.gallery[1]);
  });
  document.addEventListener('pointerout', event => {
    const media = event.target.closest('.product-card-link');
    const card = media?.closest('[data-card-preview]'); if (!card || media.contains(event.relatedTarget)) return;
    const value = states.get(card); if (!value?.hovered) return;
    value.hovered = false; show(value, value.displayImage);
  });
  document.documentElement.classList.add('has-card-previews');
})();
