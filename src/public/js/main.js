'use strict';

const menuButton = document.querySelector('.menu-toggle');
const siteNavigation = document.querySelector('#site-nav');
const languageSelect = document.querySelector('#store-language');
languageSelect?.addEventListener('change', () => languageSelect.form?.requestSubmit());

if (menuButton && siteNavigation) {
  function closeMenu() {
    menuButton.setAttribute('aria-expanded', 'false');
    siteNavigation.classList.remove('is-open');
  }
  menuButton.addEventListener('click', () => {
    const expanded = menuButton.getAttribute('aria-expanded') === 'true';
    menuButton.setAttribute('aria-expanded', String(!expanded));
    siteNavigation.classList.toggle('is-open', !expanded);
  });
  siteNavigation.addEventListener('click', event => {
    if (event.target.closest('a')) closeMenu();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && menuButton.getAttribute('aria-expanded') === 'true') {
      closeMenu();
      menuButton.focus();
    }
  });
  window.matchMedia('(min-width: 851px)').addEventListener('change', closeMenu);
}

// UI-only dialogs. No account, cart, or product-search requests are made.
document.querySelectorAll('[data-dialog]').forEach(button => {
  const dialog = document.getElementById(button.dataset.dialog);
  if (!(dialog instanceof HTMLDialogElement)) return;
  button.addEventListener('click', () => dialog.showModal());
  dialog.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      // Search inputs can otherwise consume Escape to clear text first.
      event.preventDefault();
      dialog.close();
    }
  });
  dialog.addEventListener('close', () => button.focus());
  dialog.addEventListener('click', event => {
    if (event.target.closest('a')) dialog.close();
  });
});

const searchInput = document.querySelector('#collection-search');
const searchResults = document.querySelector('#search-results');
const searchStatus = document.querySelector('#search-status');
if (searchInput && searchResults && searchStatus) {
  const collectionLinks = [...searchResults.querySelectorAll('a')];
  function updateSearch() {
    const locale = document.documentElement.lang || 'en';
    const query = searchInput.value.trim().toLocaleLowerCase(locale);
    const matches = collectionLinks.filter(link => link.textContent.toLocaleLowerCase(locale).includes(query));
    searchResults.replaceChildren();
    for (const link of matches) {
      const item = document.createElement('li');
      const result = document.createElement('a');
      result.href = link.getAttribute('href');
      result.textContent = link.textContent;
      item.append(result);
      searchResults.append(item);
    }
    searchStatus.textContent = matches.length ? `${matches.length} ${document.querySelector('#search-dialog').dataset.foundText}` : document.querySelector('#search-dialog').dataset.emptyText;
  }
  searchInput.addEventListener('input', updateSearch);
  updateSearch();
}

