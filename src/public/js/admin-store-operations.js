(() => {
  'use strict';
  const ar = document.documentElement.lang === 'ar';
  const delivery = document.querySelector('[data-delivery-form]');
  if (delivery) {
    const mode = delivery.querySelector('[data-delivery-mode]'), flat = delivery.querySelector('[data-flat-fee]');
    const rows = () => [...delivery.querySelectorAll('[data-delivery-zone]')];
    function sync() {
      const zones = rows().map(row => ({ city: row.querySelector('[data-zone-city]').value.trim(), cityAr: row.querySelector('[data-zone-ar]').value.trim(), fee: Number(row.querySelector('[data-zone-fee]').value), enabled: row.querySelector('[data-zone-enabled]').checked }));
      delivery.querySelector('[data-delivery-configuration]').value = JSON.stringify({ mode: mode.value, flatFee: Number(flat.value), zones });
      delivery.querySelector('[data-flat-fee-label]').hidden = mode.value !== 'FLAT';
      rows().forEach((row, index) => {
        const city = row.querySelector('[data-zone-city]');
        row.querySelector('[data-zone-enabled]').setAttribute('aria-label', `${ar ? 'التوصيل إلى' : 'Deliver to'} ${ar ? zones[index].cityAr : zones[index].city}`);
        city.setCustomValidity(zones.some((zone, i) => i !== index && zone.city.toLowerCase() === city.value.trim().toLowerCase()) ? (ar ? 'اسم المنطقة مكرر.' : 'This area is listed twice.') : '');
        row.querySelector('[data-zone-fee]').disabled = mode.value === 'FLAT' || !row.querySelector('[data-zone-enabled]').checked;
        const removeButton = row.querySelector('[data-remove-zone]');
        if (removeButton) { removeButton.disabled = rows().length <= 1; removeButton.title = removeButton.disabled ? (ar ? 'ÙŠØ¬Ø¨ Ø¥Ø¨Ù‚Ø§Ø¡ Ù…Ù†Ø·Ù‚Ø© ÙˆØ§Ø­Ø¯Ø© Ø¹Ù„Ù‰ Ø§Ù„Ø£Ù‚Ù„.' : 'Keep at least one delivery area.') : ''; }
      });
      const count = zones.filter(zone => zone.enabled).length;
      delivery.querySelector('[data-delivery-summary]').textContent = ar ? `${count} مناطق متاحة للتوصيل. السعر ٠ يعني توصيلًا مجانيًا.` : `${count} areas available. A fee of 0 means free delivery.`;
    }
    delivery.addEventListener('input', sync); delivery.addEventListener('change', sync); delivery.addEventListener('submit', sync);
    delivery.querySelector('[data-add-zone]').addEventListener('click', () => {
      if (rows().length >= 100) return;
      const row = rows()[0].cloneNode(true);
      row.querySelector('[data-remove-zone]')?.remove();
      row.querySelectorAll('input').forEach(input => { input.disabled = false; if (input.type === 'checkbox') input.checked = true; else input.value = input.type === 'number' ? '0' : ''; });
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'button button-secondary'; remove.dataset.removeZone = ''; remove.textContent = ar ? 'إلغاء هذه المنطقة' : 'Remove this area'; row.append(remove);
      delivery.querySelector('[data-delivery-zones]').append(row); sync(); row.querySelector('[data-zone-city]').focus();
    });
    delivery.addEventListener('click', event => { const remove = event.target.closest('[data-remove-zone]'); if (remove) { remove.closest('[data-delivery-zone]').remove(); sync(); } });
    sync();
  }
  const presets = {
    OFFER: { titleEn: 'New offer at Alreda Store', titleAr: 'عرض جديد في متجر الرضا', bodyEn: 'Discover our latest offers and choose your favorites.', bodyAr: 'اكتشف أحدث عروضنا واختر منتجاتك المفضلة.', url: '/products' },
    NEW: { titleEn: 'Discover our latest products', titleAr: 'اكتشف أحدث منتجاتنا', bodyEn: 'Explore the latest additions to our collections.', bodyAr: 'تصفح أحدث الإضافات إلى مجموعاتنا.', url: '/products' },
  };
  document.querySelectorAll('[data-campaign-form], [data-template-form]').forEach(form => {
    const fields = [...form.querySelectorAll('[data-message-field]')];
    const message = () => Object.fromEntries(fields.map(field => [field.dataset.messageField, field.value.trim()]));
    function sync() {
      const value = message();
      const link = fields.find(field => field.dataset.messageField === 'url');
      let safeLink = false;
      try { safeLink = value.url.startsWith('/') && !value.url.startsWith('//') && !value.url.includes('\\') && new URL(value.url, location.origin).origin === location.origin; } catch { /* invalid store path */ }
      link.setCustomValidity(safeLink ? '' : (ar ? 'اكتب رابطًا داخليًا يبدأ بشرطة مائلة واحدة /.' : 'Enter a store path beginning with one /.'));
      form.querySelector('[data-push-preview-title]').textContent = value[ar ? 'titleAr' : 'titleEn'] || (ar ? 'عنوان الإشعار' : 'Notification title');
      form.querySelector('[data-push-preview-body]').textContent = value[ar ? 'bodyAr' : 'bodyEn'] || (ar ? 'نص رسالتك سيظهر هنا.' : 'Your message appears here.');
      const configuration = form.matches('[data-campaign-form]') ? { requestKey: form.dataset.requestKey, audience: form.querySelector('[data-push-audience]').value, message: value }
        : { eventType: form.dataset.eventType, enabled: form.querySelector('[data-template-enabled]').checked, message: value };
      if (form.matches('[data-campaign-form]')) {
        const count = Number(form.querySelector('[data-push-audience]').selectedOptions[0].dataset.recipientCount || 0);
        form.querySelector('button[type=submit]').disabled = form.dataset.pushReady !== 'true' || count === 0 || count > 5000;
        form.querySelector('[data-audience-note]').textContent = count === 0 ? (ar ? 'لا يوجد مستلمون مؤهلون في هذا الاختيار حاليًا.' : 'There are no eligible recipients in this audience yet.')
          : count > 5000 ? (ar ? 'اختر جمهورًا أصغر؛ الحد ٥٠٠٠ عميل للحملة.' : 'Choose a smaller audience; the limit is 5,000 customers per campaign.')
            : (ar ? `الجمهور المتوقع: ${count} عميل. العدد الفعلي يُراجع عند الإرسال.` : `Expected audience: ${count} customers. Eligibility is checked again when sending.`);
      }
      form.querySelector('[data-operation-configuration]').value = JSON.stringify(configuration);
    }
    fields.forEach(field => field.addEventListener('input', sync));
    form.addEventListener('change', sync);
    const preset = form.querySelector('[data-push-preset]');
    preset?.addEventListener('change', () => {
      const selected = presets[preset.value]; if (!selected) return;
      // Presets are explicit choices; retain the current message unless the user selects one.
      fields.forEach(field => { field.value = selected[field.dataset.messageField]; }); sync();
    });
    let confirmed = false;
    const dialog = form.querySelector('[data-push-review]');
    form.addEventListener('submit', event => {
      sync();
      if (!dialog || confirmed) return;
      event.preventDefault();
      const value = message();
      dialog.querySelector('[data-review-audience]').textContent = form.querySelector('[data-push-audience]').selectedOptions[0].textContent;
      dialog.querySelector('[data-review-title]').textContent = value[ar ? 'titleAr' : 'titleEn'];
      dialog.querySelector('[data-review-body]').textContent = value[ar ? 'bodyAr' : 'bodyEn'];
      dialog.showModal();
    });
    form.querySelector('[data-cancel-push]')?.addEventListener('click', () => dialog.close());
    form.querySelector('[data-confirm-push]')?.addEventListener('click', event => {
      confirmed = true; event.target.disabled = true; dialog.close(); form.requestSubmit();
    });
    sync();
  });
})();
