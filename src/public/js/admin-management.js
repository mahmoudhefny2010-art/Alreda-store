'use strict';
(() => {
  document.querySelector('#admin-language')?.addEventListener('change', event => event.target.form.requestSubmit());
  const scope = document.querySelector('[data-discount-scope]');
  function updateScope() {
    document.querySelectorAll('[data-scope-target]').forEach(field => { field.disabled = field.dataset.scopeTarget !== scope.value; });
    document.querySelectorAll('[data-scope-control]').forEach(label => { label.hidden = label.dataset.scopeControl !== scope.value; });
  }
  scope?.addEventListener('change', updateScope); if (scope) updateScope();
  document.querySelectorAll('[data-product-search]').forEach(input => {
    const fieldset = input.closest('[data-scope-control="PRODUCT"]');
    const cards = [...(fieldset?.querySelectorAll('[data-product-search-card]') || [])];
    const emptyMessage = fieldset?.querySelector('[data-product-search-empty]');
    function filterProducts() {
      const query = input.value.trim().toLocaleLowerCase(document.documentElement.lang || 'en');
      let visible = 0;
      for (const card of cards) {
        const match = !query || card.dataset.searchText.includes(query) || card.querySelector('strong')?.textContent.toLocaleLowerCase(document.documentElement.lang || 'en').includes(query) || card.querySelector('input')?.checked;
        card.hidden = !match;
        if (match) visible++;
      }
      if (emptyMessage) emptyMessage.hidden = visible > 0;
    }
    input.addEventListener('input', filterProducts);
  });
  const offerSearch = document.querySelector('[data-offer-search]');
  if (offerSearch) {
    const cards = [...document.querySelectorAll('[data-offer-search-card]')];
    const emptyMessage = document.querySelector('[data-offer-search-empty]');
    function filterOfferProducts() {
      const query = offerSearch.value.trim().toLocaleLowerCase(document.documentElement.lang || 'en');
      let visible = 0;
      for (const card of cards) {
        const match = query.length >= 2 && card.dataset.searchText.includes(query);
        card.hidden = !match;
        if (match) visible++;
      }
      if (emptyMessage) emptyMessage.hidden = query.length < 2 || visible > 0;
    }
    offerSearch.addEventListener('input', filterOfferProducts);
  }
})();
