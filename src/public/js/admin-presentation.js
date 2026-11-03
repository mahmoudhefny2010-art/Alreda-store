(() => {
  'use strict';
  const root = document.querySelector('[data-product-presentation]');
  if (!root) return;
  const form = root.closest('form'), hidden = root.querySelector('[data-presentation-value]');
  const ar = root.dataset.locale === 'ar';
  let data; try { data = JSON.parse(hidden.value); } catch { data = {}; }
  data = { hoverImage: data.hoverImage || '', mobileImage: data.mobileImage || '', manageTypes: Boolean(data.manageTypes), types: data.types || [] };
  const urls = () => (form.querySelector('[data-image-urls]')?.value || '').split(/\r?\n/).filter(Boolean);
  const save = () => { hidden.value = JSON.stringify(data); updateSummary(); };
  function updateSummary() {
    let colors = [];
    try { colors = JSON.parse(form.querySelector('[data-color-variants]')?.value || '[]').map(item => item.color); } catch { /* no selected colors */ }
    const total = data.types.reduce((sum, item) => sum + (Number(item.stock) || 0), 0);
    const mainStock = form.querySelector('[name="stock"]');
    if (mainStock) {
      mainStock.readOnly = data.manageTypes;
      if (data.manageTypes) mainStock.value = String(total);
    }
    form.querySelectorAll('[data-color-stock]').forEach(input => {
      input.disabled = data.manageTypes;
      input.title = data.manageTypes ? (ar ? 'المخزون محسوب من الأنواع أدناه' : 'Stock is calculated from the types below') : '';
    });
    const summary = root.querySelector('[data-types-summary]');
    if (summary) summary.textContent = ar ? `${data.types.length} أنواع · إجمالي المخزون: ${total} قطعة` : `${data.types.length} types · Total stock: ${total} units`;
    root.querySelectorAll('[data-stock-breakdown]').forEach((node, index) => {
      const stock = Math.max(0, Number(data.types[index]?.stock) || 0);
      node.textContent = colors.length ? colors.map((color, i) => {
        const label = ar ? form.querySelector(`[data-color-en="${color}"]`)?.dataset.colorAr || color : color;
        return `${label}: ${Math.floor(stock / colors.length) + (i < stock % colors.length ? 1 : 0)}`;
      }).join(' · ') : (ar ? `المتاح من هذا النوع: ${stock}` : `Available for this type: ${stock}`);
    });
  }
  function imageOptions(select, selected, optional = true) {
    select.replaceChildren();
    if (optional) select.add(new Option(ar ? 'تلقائي' : 'Automatic', ''));
    if (!optional && !urls().length) select.add(new Option(ar ? 'ارفع صورة للمنتج أولًا' : 'Upload a product photo first', ''));
    urls().forEach((url, index) => select.add(new Option(`${ar ? 'صورة' : 'Image'} ${index + 1}`, url)));
    select.value = urls().includes(selected) ? selected : (optional ? '' : urls()[0] || '');
  }
  function preview(image, url) { image.hidden = !url; if (url) image.src = url; else image.removeAttribute('src'); }
  const presets = JSON.parse(root.dataset.typeOptions || '[]');
  const preset = root.querySelector('[data-type-preset]');
  presets.forEach((type, index) => preset.add(new Option(ar ? type.ar : type.en, String(index))));
  preset.add(new Option(ar ? 'نوع جديد' : 'Custom type', 'custom'));
  function field(label, element) { const wrapper = document.createElement('label'); wrapper.append(label, element); return wrapper; }
  function input(value, lang, change, type = 'text') {
    const node = document.createElement('input'); node.type = type; node.value = value; node.lang = lang; node.dir = lang === 'ar' ? 'rtl' : 'ltr';
    if (type === 'number') { node.min = '0'; node.max = '1000000'; node.step = '1'; }
    node.required = data.manageTypes; node.addEventListener('input', () => { change(type === 'number' ? Number(node.value) : node.value); save(); }); return node;
  }
  function render() {
    root.querySelector('[data-type-controls]').hidden = !data.manageTypes;
    root.querySelector('[data-types-empty]').hidden = Boolean(data.types.length);
    root.querySelector('[data-manage-types]').setCustomValidity(data.manageTypes && !data.types.length ? (ar ? 'أضف نوعًا واحدًا على الأقل أو أوقف إدارة الأنواع.' : 'Add at least one type, or turn type management off.') : '');
    root.querySelectorAll('[data-presentation-image]').forEach(select => {
      const key = select.dataset.presentationImage; imageOptions(select, data[key]); data[key] = select.value;
      const fallback = key === 'hoverImage' ? (urls()[1] || urls()[0]) : urls()[0];
      const effective = select.value || fallback;
      preview(root.querySelector(`[data-presentation-preview="${key}"]`), effective);
      root.querySelector(`[data-preview-empty="${key}"]`).hidden = Boolean(effective);
      const choices = root.querySelector(`[data-image-choices="${key}"]`); choices.replaceChildren();
      urls().forEach((url, index) => {
        const button = document.createElement('button'); button.type = 'button';
        button.setAttribute('aria-label', `${ar ? 'اختيار صورة' : 'Choose image'} ${index + 1}`);
        button.setAttribute('aria-pressed', String(url === effective));
        const photo = document.createElement('img'); photo.src = url; photo.alt = ''; photo.loading = 'lazy';
        const number = document.createElement('span'); number.textContent = String(index + 1);
        button.append(photo, number); button.addEventListener('click', () => { data[key] = url; render(); }); choices.append(button);
      });
    });
    const rows = root.querySelector('[data-type-rows]'); rows.replaceChildren();
    for (const item of data.types) {
      const row = document.createElement('div'); row.className = 'catalog-type-row'; row.hidden = !data.manageTypes;
      const title = document.createElement('strong'); title.className = 'presentation-type-name'; title.textContent = (ar ? item.ar : item.en) || (ar ? 'نوع جديد' : 'Custom type');
      const en = input(item.en, 'en', value => { item.en = value; }); en.maxLength = 80;
      const arabic = input(item.ar, 'ar', value => { item.ar = value; }); arabic.maxLength = 100;
      en.addEventListener('translation:filled', () => { item.en = en.value; save(); });
      arabic.addEventListener('translation:filled', () => { item.ar = arabic.value; save(); });
      const bilingual = document.createElement('div'); bilingual.className = 'admin-bilingual'; bilingual.dataset.autoTranslate = '';
      en.name = ''; arabic.name = ''; bilingual.append(field(ar ? 'الاسم بالإنجليزية' : 'English name', en), field(ar ? 'الاسم بالعربية' : 'Arabic name', arabic));
      const select = document.createElement('select'); imageOptions(select, item.imageUrl, false); item.imageUrl = select.value;
      select.required = data.manageTypes; const image = document.createElement('img'); image.alt = ''; image.className = 'catalog-color-image-preview'; preview(image, select.value);
      select.addEventListener('change', () => { item.imageUrl = select.value; preview(image, select.value); save(); });
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'button button-secondary'; remove.textContent = ar ? 'حذف النوع' : 'Remove type';
      remove.addEventListener('click', () => { data.types = data.types.filter(type => type !== item); render(); });
      const price = input(item.priceEgp, 'en', value => { item.priceEgp = value; }, 'number'); price.min = '1'; price.max = '10000000';
      const breakdown = document.createElement('small'); breakdown.className = 'presentation-breakdown'; breakdown.dataset.stockBreakdown = '';
      row.append(title, bilingual, field(ar ? 'الصورة' : 'Image', select), image,
        field(ar ? 'المخزون' : 'Stock', input(item.stock, 'en', value => { item.stock = value; }, 'number')),
        field(ar ? 'سعر هذا النوع (جنيه)' : 'Type price (EGP)', price), breakdown, remove);
      rows.append(row);
    }
    save();
  }
  root.querySelector('[data-add-type]').addEventListener('click', () => {
    const choice = presets[Number(preset.value)];
    if (preset.value !== 'custom' && data.types.some(item => item.en === choice.en)) return;
    data.types.push({ en: choice?.en || '', ar: choice?.ar || '', imageUrl: urls()[0] || '', stock: 0, priceEgp: Number(form.querySelector('[name="priceEgp"]').value) || 1 }); render();
  });
  root.querySelector('[data-presentation-upload]').addEventListener('click', () => form.querySelector('[data-image-files]')?.click());
  root.querySelector('[data-manage-types]').addEventListener('change', event => { data.manageTypes = event.target.checked; render(); });
  root.querySelectorAll('[data-presentation-image]').forEach(select => select.addEventListener('change', () => { data[select.dataset.presentationImage] = select.value; render(); }));
  form.addEventListener('catalog:images-changed', render);
  form.addEventListener('click', event => { if (event.target.closest('[data-color-choice]')) updateSummary(); });
  form.addEventListener('submit', () => { save(); });
  render();
})();
