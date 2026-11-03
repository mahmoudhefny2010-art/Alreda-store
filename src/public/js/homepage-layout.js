'use strict';
(() => {
  const root = document.querySelector('[data-home-layout]');
  if (!root) return;
  const saveButton = root.querySelector('[data-save-layout]');
  const status = root.querySelector('[data-save-status]');
  let dirty = false;
  let dragging = null;
  const items = list => [...list.querySelectorAll(':scope > [data-home-category]')];
  const syncEmptyHints = () => root.querySelectorAll('[data-drop-section]').forEach(list => {
    let hint = list.querySelector('.homepage-drop-hint');
    if (!hint && items(list).length === 0 && list.dataset.dropSection !== 'hidden') {
      hint = document.createElement('p');
      hint.className = 'homepage-drop-hint';
      hint.textContent = root.dataset.emptyLabel;
      list.append(hint);
    }
    if (hint) hint.hidden = items(list).length > 0;
  });
  const setDirty = () => { dirty = true; saveButton.disabled = false; status.textContent = ''; syncEmptyHints(); };
  const moveItem = (card, direction) => {
    const list = card.parentElement;
    const cards = items(list);
    const index = cards.indexOf(card);
    if (direction < 0 && index > 0) list.insertBefore(card, cards[index - 1]);
    if (direction > 0 && index < cards.length - 1) list.insertBefore(cards[index + 1], card);
    setDirty();
  };
  root.addEventListener('click', event => {
    const itemButton = event.target.closest('[data-item-up], [data-item-down]');
    if (itemButton) moveItem(itemButton.closest('[data-home-category]'), itemButton.hasAttribute('data-item-up') ? -1 : 1);
    const sectionButton = event.target.closest('[data-section-up], [data-section-down]');
    if (sectionButton) {
      const section = sectionButton.closest('[data-home-section]');
      const sections = [...root.querySelectorAll('[data-section-list] > [data-home-section]')];
      const index = sections.indexOf(section);
      if (sectionButton.hasAttribute('data-section-up') && index > 0) section.parentElement.insertBefore(section, sections[index - 1]);
      if (sectionButton.hasAttribute('data-section-down') && index < sections.length - 1) section.parentElement.insertBefore(sections[index + 1], section);
      setDirty();
    }
  });
  root.addEventListener('input', event => {
    if (event.target.matches('[data-section-title-en], [data-section-title-ar], [data-category-name-en], [data-category-name-ar]')) setDirty();
  });
  root.addEventListener('change', event => {
    if (!event.target.matches('[data-category-section]')) return;
    const card = event.target.closest('[data-home-category]');
    const destination = [...root.querySelectorAll('[data-drop-section]')]
      .find(list => list.dataset.dropSection === event.target.value);
    if (!card || !destination) return;
    destination.append(card);
    setDirty();
  });
  root.addEventListener('pointerdown', event => {
    const handle = event.target.closest('[data-drag-handle]');
    if (!handle || event.button !== 0) return;
    dragging = handle.closest('[data-home-category]');
    if (!dragging) return;
    handle.setPointerCapture(event.pointerId);
    dragging.classList.add('is-dragging');
    event.preventDefault();
  });
  root.addEventListener('pointermove', event => {
    if (!dragging) return;
    const target = document.elementFromPoint(event.clientX, event.clientY);
    const list = target?.closest('[data-drop-section]');
    if (!list || list.closest('[data-hidden-section]') && target.closest('[data-home-section]')) return;
    root.querySelectorAll('.is-drop-target').forEach(value => value.classList.remove('is-drop-target'));
    list.classList.add('is-drop-target');
    const before = target.closest('[data-home-category]');
    if (before && before !== dragging && before.parentElement === list) {
      const rect = before.getBoundingClientRect();
      list.insertBefore(dragging, event.clientY < rect.top + rect.height / 2 ? before : before.nextSibling);
    } else if (!before && target.closest('[data-drop-section]') === list) list.append(dragging);
    else if (before && before !== dragging && before.parentElement !== list) list.insertBefore(dragging, before);
    syncEmptyHints();
  });
  const stopDragging = () => {
    if (!dragging) return;
    const destination = dragging.parentElement?.dataset.dropSection;
    const picker = dragging.querySelector('[data-category-section]');
    if (picker && destination) picker.value = destination;
    dragging.classList.remove('is-dragging');
    root.querySelectorAll('.is-drop-target').forEach(value => value.classList.remove('is-drop-target'));
    dragging = null;
    setDirty();
  };
  root.addEventListener('pointerup', stopDragging);
  root.addEventListener('pointercancel', stopDragging);
  saveButton.addEventListener('click', async () => {
    if (!dirty) return;
    saveButton.disabled = true;
    saveButton.setAttribute('aria-busy', 'true');
    status.textContent = '';
    const sections = [...root.querySelectorAll('[data-section-list] > [data-home-section]')].map(section => ({
      id: section.dataset.sectionId,
      titleEn: section.querySelector('[data-section-title-en]').value.trim(),
      titleAr: section.querySelector('[data-section-title-ar]').value.trim(),
    }));
    const categories = [...root.querySelectorAll('[data-home-category]')].map(card => ({
      id: card.dataset.categoryId,
      sectionId: card.closest('[data-drop-section]')?.dataset.dropSection === 'hidden' ? null : card.closest('[data-drop-section]')?.dataset.dropSection || null,
      nameEn: card.querySelector('[data-category-name-en]').value.trim(),
      nameAr: card.querySelector('[data-category-name-ar]').value.trim(),
    }));
    try {
      const response = await fetch(root.dataset.saveUrl, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ sections, categories }) });
      if (!response.ok) throw new Error('SAVE_FAILED');
      dirty = false;
      status.textContent = root.dataset.saved;
    } catch {
      saveButton.disabled = false;
      dirty = true;
      status.textContent = root.dataset.error;
    } finally { saveButton.removeAttribute('aria-busy'); }
  });
})();
