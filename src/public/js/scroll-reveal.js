'use strict';

(() => {
  if (typeof window.IntersectionObserver !== 'function' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const selector = '.category-card, .product-card, .collections-section';
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('is-visible');
      observer.unobserve(entry.target);
    }
  }, { rootMargin: '0px 0px -32px 0px', threshold: 0.01 });

  function register(root) {
    if (!(root instanceof Element) && root !== document) return;
    const targets = [];
    if (root instanceof Element && root.matches(selector)) targets.push(root);
    targets.push(...root.querySelectorAll(selector));
    for (const target of targets) {
      if (target.matches('.category-card, .product-card')) {
        const peers = [...(target.parentElement?.children || [])].filter(element => element.matches('.category-card, .product-card'));
        target.style.setProperty('--reveal-delay', `${Math.min(peers.indexOf(target) * 70, 280)}ms`);
      }
      observer.observe(target);
    }
  }

  document.documentElement.classList.add('has-scroll-reveal');
  register(document);

  const additions = new MutationObserver(records => {
    for (const record of records) for (const node of record.addedNodes) register(node);
  });
  additions.observe(document.body, { childList: true, subtree: true });
})();
