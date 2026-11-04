'use strict';

const menuButtons = [...document.querySelectorAll('.menu-toggle')];
const menuButton = menuButtons.find(button => !button.hasAttribute('data-bottom-menu-toggle')) || menuButtons[0];
const siteNavigation = document.querySelector('#site-nav');
const languageSelect = document.querySelector('#store-language');
languageSelect?.addEventListener('change', () => languageSelect.form?.requestSubmit());

if (menuButton && siteNavigation) {
  let lastMenuButton = menuButton;
  function closeMenu() {
    menuButtons.forEach(button => button.setAttribute('aria-expanded', 'false'));
    siteNavigation.classList.remove('is-open');
  }
  menuButtons.forEach(button => button.addEventListener('click', () => {
    lastMenuButton = button;
    const expanded = siteNavigation.classList.contains('is-open');
    menuButtons.forEach(item => item.setAttribute('aria-expanded', String(!expanded)));
    siteNavigation.classList.toggle('is-open', !expanded);
  }));
  siteNavigation.addEventListener('click', event => {
    if (event.target.closest('a')) closeMenu();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && menuButton.getAttribute('aria-expanded') === 'true') {
      closeMenu();
      lastMenuButton.focus();
    }
  });
  window.matchMedia('(min-width: 851px)').addEventListener('change', closeMenu);
}

const mobileBottomNavigation = document.querySelector('.mobile-bottom-nav');
if (mobileBottomNavigation && 'IntersectionObserver' in window) {
  const mobileViewport = window.matchMedia('(max-width: 850px)');
  const header = document.querySelector('.shop-header');
  const footer = document.querySelector('.shop-footer');
  const footerHideMargin = 72;
  let headerPassed = !header;
  let footerEntered = false;
  const updateMobileNavigation = () => {
    const visible = mobileViewport.matches && headerPassed && !footerEntered;
    mobileBottomNavigation.classList.toggle('is-visible', visible);
    mobileBottomNavigation.setAttribute('aria-hidden', String(!visible));
    mobileBottomNavigation.inert = !visible;
  };
  if (header) {
    new IntersectionObserver(([entry]) => {
      headerPassed = !entry.isIntersecting && entry.boundingClientRect.bottom <= 0;
      updateMobileNavigation();
    }).observe(header);
  }
  if (footer) {
    new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) footerEntered = true;
      else if (entry.boundingClientRect.top >= innerHeight - footerHideMargin || entry.boundingClientRect.bottom <= 0) footerEntered = false;
      updateMobileNavigation();
    }, { rootMargin: `0px 0px -${footerHideMargin}px 0px` }).observe(footer);
  }
  mobileViewport.addEventListener('change', updateMobileNavigation);
  updateMobileNavigation();
}

// A small touch-only pull gesture gives mobile browsers an intentional refresh cue.
// It activates only at the top of the document and yields to horizontal carousels and controls.
const pullRefresh = document.querySelector('[data-pull-refresh]');
if (pullRefresh && 'ontouchstart' in window) {
  const label = pullRefresh.querySelector('[data-pull-refresh-label]');
  const mobile = window.matchMedia('(max-width: 850px)');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const threshold = 84;
  let startX = 0;
  let startY = 0;
  let distance = 0;
  let tracking = false;
  let refreshing = false;
  const setState = state => {
    pullRefresh.dataset.state = state;
    pullRefresh.setAttribute('aria-hidden', String(state === 'idle'));
    if (label) label.textContent = state === 'ready' ? pullRefresh.dataset.releaseLabel : state === 'refreshing' ? pullRefresh.dataset.refreshingLabel : pullRefresh.dataset.pullLabel;
  };
  const cancelPull = () => {
    tracking = false;
    distance = 0;
    pullRefresh.style.setProperty('--pull-distance', '0px');
    setState('idle');
  };
  document.addEventListener('touchstart', event => {
    if (refreshing) return;
    if (!mobile.matches || event.touches.length !== 1 || window.scrollY > 0) { cancelPull(); return; }
    const target = event.target;
    if (!(target instanceof Element) || target.closest('input, textarea, select, button, [contenteditable="true"], dialog, .product-thumbnails, .product-grid, [data-no-pull-refresh]')) return;
    startX = event.touches[0].clientX;
    startY = event.touches[0].clientY;
    distance = 0;
    tracking = true;
  }, { passive: true });
  document.addEventListener('touchmove', event => {
    if (!tracking) return;
    if (event.touches.length !== 1) { cancelPull(); return; }
    const dx = event.touches[0].clientX - startX;
    const dy = event.touches[0].clientY - startY;
    if (Math.abs(dx) > Math.max(12, dy * 0.7) || dy < 0) { cancelPull(); return; }
    if (dy < 8 || window.scrollY > 0) return;
    distance = Math.min(dy, 132);
    pullRefresh.style.setProperty('--pull-distance', `${distance}px`);
    pullRefresh.style.setProperty('--pull-angle', `${Math.round((distance / 132) * 300)}deg`);
    setState(distance >= threshold ? 'ready' : 'pulling');
    if (event.cancelable) event.preventDefault();
  }, { passive: false });
  const finishPull = () => {
    if (!tracking) return;
    tracking = false;
    if (distance >= threshold && mobile.matches) {
      refreshing = true;
      pullRefresh.style.setProperty('--pull-distance', '64px');
      setState('refreshing');
      window.setTimeout(() => window.location.reload(), reducedMotion.matches ? 0 : 240);
    } else {
      cancelPull();
    }
  };
  document.addEventListener('touchend', finishPull, { passive: true });
  document.addEventListener('touchcancel', () => { if (!refreshing) cancelPull(); }, { passive: true });
  mobile.addEventListener('change', event => { if (!event.matches && !refreshing) cancelPull(); });
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

