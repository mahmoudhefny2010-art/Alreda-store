'use strict';

(() => {
  const contact = document.querySelector('[data-whatsapp-contact]');
  if (!contact) return;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const timers = [];
  let started = false;
  function stopIntro() {
    timers.forEach(timer => window.clearTimeout(timer));
    contact.classList.remove('is-revealed');
  }
  function startIntro() {
    if (started) return;
    started = true;
    if (reducedMotion.matches) return;
    timers.push(window.setTimeout(() => {
      contact.classList.add('is-revealed');
      // Full exposure lasts 2 seconds after the 450ms slide-out finishes.
      timers.push(window.setTimeout(() => contact.classList.remove('is-revealed'), 450 + 2000));
    }, 400));
  }
  if (document.readyState === 'complete') startIntro();
  else window.addEventListener('load', startIntro, { once: true });
  function userTookControl() {
    started = true;
    stopIntro();
  }
  contact.addEventListener('pointerenter', event => {
    if (event.pointerType === 'mouse' && window.matchMedia('(hover: hover)').matches) userTookControl();
  });
  contact.addEventListener('focusin', userTookControl);
  reducedMotion.addEventListener('change', event => { if (event.matches) stopIntro(); });
  window.addEventListener('pagehide', stopIntro, { once: true });

  const footer = document.querySelector('.shop-footer');
  if (!footer) return;
  let frame = null;
  function updatePosition() {
    frame = null;
    const edge = Number.parseFloat(window.getComputedStyle(contact).getPropertyValue('--whatsapp-edge'));
    const rectangle = footer.getBoundingClientRect();
    const visible = rectangle.top < window.innerHeight && rectangle.bottom > 0;
    const requested = visible ? Math.max(edge, window.innerHeight - rectangle.top + 12) : edge;
    const offset = Math.min(requested, Math.max(edge, window.innerHeight - contact.offsetHeight - 12));
    contact.style.setProperty('--whatsapp-offset', `${offset}px`);
  }
  function schedulePosition() {
    if (frame === null) frame = window.requestAnimationFrame(updatePosition);
  }
  window.addEventListener('scroll', schedulePosition, { passive: true });
  window.addEventListener('resize', schedulePosition);
  if ('ResizeObserver' in window) {
    const observer = new ResizeObserver(schedulePosition);
    observer.observe(footer);
  }
  updatePosition();
})();
