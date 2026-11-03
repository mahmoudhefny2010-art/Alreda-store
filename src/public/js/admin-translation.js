(() => {
  'use strict';
  const states = new WeakMap(), pending = new Set();
  const isArabic = document.documentElement.lang === 'ar';
  function pairState(pair) {
    if (states.has(pair)) return states.get(pair);
    const fields = [...pair.querySelectorAll('input:not([type="hidden"]), textarea:not([data-rich-value]), [data-rich-surface]')];
    if (fields.length !== 2) return null;
    const status = document.createElement('small'); status.className = 'catalog-translation-status'; status.setAttribute('role', 'status'); pair.append(status);
    const state = { fields, status, revision: 0, generated: new WeakMap(), timer: null };
    states.set(pair, state); return state;
  }
  const read = field => field.matches('[data-rich-surface]') ? field.innerHTML : field.value;
  async function translate(pair, source) {
    const state = pairState(pair); if (!state) return;
    const target = state.fields.find(field => field !== source), text = read(source).trim(), revision = ++state.revision;
    // Protect an independently edited translation from automatic replacement.
    if (read(target).trim() && read(target) !== state.generated.get(target)) return;
    if (!text) { state.status.textContent = ''; return; }
    state.status.textContent = isArabic ? 'جاري تعبئة الترجمة…' : 'Filling translation…';
    const targetBefore = read(target);
    try {
      const response = await fetch('/api/admin/catalog/translate', { method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, source: source.lang || 'en', rich: source.matches('[data-rich-surface]') }) });
      const result = await response.json();
      if (revision !== state.revision || targetBefore !== read(target) || text !== read(source).trim()) return;
      if (!response.ok || !result.complete || typeof result.translated !== 'string') {
        state.status.textContent = isArabic ? 'النص غير موجود بالقاموس. اكتب الترجمة يدويًا.' : 'This text is not in the catalog dictionary. Enter its translation manually.'; return;
      }
      if (target.matches('[data-rich-surface]')) {
        // Server output is sanitized with the same allow-list as stored descriptions.
        target.innerHTML = result.translated;
        target.closest('[data-rich-editor]').querySelector('[data-rich-value]').value = result.translated;
      } else target.value = result.translated;
      state.generated.set(target, read(target));
      target.dispatchEvent(new CustomEvent('translation:filled', { bubbles: true }));
      state.status.textContent = isArabic ? 'تمت تعبئة الترجمة — يمكنك تعديلها.' : 'Translation filled — you can edit it.';
    } catch { if (revision === state.revision) state.status.textContent = isArabic ? 'تعذر تعبئة الترجمة. أدخلها يدويًا.' : 'Translation unavailable. Enter it manually.'; }
  }
  document.addEventListener('input', event => {
    const pair = event.target.closest('.admin-bilingual'); if (!pair) return;
    const state = pairState(pair); if (!state?.fields.includes(event.target)) return;
    clearTimeout(state.timer); state.revision++;
    state.timer = setTimeout(() => {
      const work = translate(pair, event.target); pending.add(work); work.finally(() => pending.delete(work));
    }, 650);
  });
  document.querySelectorAll('form').forEach(form => form.addEventListener('submit', event => {
    form.querySelectorAll('.admin-bilingual').forEach(pair => {
      const state = states.get(pair);
      if (!state?.timer) return;
      clearTimeout(state.timer); state.timer = null;
      const source = state.fields.find(field => read(field).trim() && !state.generated.has(field));
      if (source) { const work = translate(pair, source); pending.add(work); work.finally(() => pending.delete(work)); }
    });
    if (!pending.size) return;
    event.preventDefault(); const submitter = event.submitter;
    Promise.allSettled([...pending]).then(() => form.requestSubmit(submitter));
  }));
})();
