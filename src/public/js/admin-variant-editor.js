(() => {
  'use strict';
  const root = document.querySelector('[data-variant-editor]'); if (!root) return;
  const form = root.closest('form'), hidden = root.querySelector('[data-variant-editor-value]'), toggle = root.querySelector('[data-variant-editor-toggle]');
  const ar = root.dataset.locale === 'ar', text = (en, arabic) => ar ? arabic : en;
  let data; try { data = JSON.parse(hidden.value); } catch { return; }
  const rows = root.querySelector('[data-variant-rows]'), search = root.querySelector('[data-variant-search]'), filter = root.querySelector('[data-variant-filter]'), status = root.querySelector('[data-variant-editor-status]');
  const urls = () => (form.querySelector('[data-image-urls]')?.value || '').split(/\r?\n/).filter(Boolean);
  const field = (label, input) => { const node = document.createElement('label'); node.append(document.createTextNode(label), input); return node; };
  function input(value, change, type = 'text') { const node = document.createElement('input'); node.type = type; node.value = value ?? ''; if (type === 'number') { node.min='0';node.max='10000000';node.step='1'; } node.addEventListener('input',()=>{change(type==='number'?(node.value===''?null:Number(node.value)):node.value);sync();});return node; }
  function imageOptions(select, value) { select.replaceChildren(); select.add(new Option(text('Choose image','اختر الصورة'),''));urls().forEach((url,index)=>select.add(new Option(`${text('Image','صورة')} ${index+1}`,url)));select.value=urls().includes(value)?value:''; }
  function visible(row) { const query=search.value.trim().toLowerCase(); let match=true;try{if(filter.value){const[index,value]=JSON.parse(filter.value);match=row.values[index]===value;}}catch{match=false;}return match&&(!query||[...row.values,row.titleAr].join(' ').toLowerCase().includes(query)); }
  function sync() {
    hidden.value=JSON.stringify(data); toggle.checked=data.enabled;
    form.classList.toggle('has-variant-editor',data.enabled); root.querySelector('[data-variant-editor-controls]').hidden=!data.enabled;
    const colorPicker=form.querySelector('[data-catalog-color-picker]'); if(colorPicker){colorPicker.hidden=data.enabled;}
    const productOffer=form.querySelector('[name="salePriceEgp"]'); if(productOffer?.parentElement){productOffer.parentElement.hidden=data.enabled;}
    const legacyToggle=form.querySelector('[data-manage-types]'); if(legacyToggle){legacyToggle.disabled=data.enabled;}
    const total=data.rows.reduce((sum,row)=>sum+(row.available?Number(row.stock)||0:0),0), stock=form.querySelector('[name="stock"]');
    if(data.enabled&&stock){stock.value=String(total);stock.readOnly=true;}
    [...rows.children].forEach((node,index)=>{node.hidden=!visible(data.rows[index]);});
    root.querySelector('[data-variant-bulk-count]').textContent=`${data.rows.filter(visible).length} ${text('visible combinations','اختيارات ظاهرة')}`;
  }
  function rebuildFilter() { const value=filter.value;filter.replaceChildren(new Option(text('All','الكل'),''));data.options.forEach((option,index)=>[...new Set(data.rows.map(row=>row.values[index]).filter(Boolean))].forEach(value=>filter.add(new Option(`${ar?option.nameAr||option.name:option.name}: ${value}`,JSON.stringify([index,value])))));filter.value=value; }
  function renderOptions() {
    const target=root.querySelector('[data-variant-options]');target.replaceChildren();
    data.options.forEach((option,index)=>{
      const row=document.createElement('div');row.className='variant-option-definition';
      const name=input(option.name,value=>{option.name=value;});name.maxLength=60;
      const arabic=input(option.nameAr,value=>{option.nameAr=value;});arabic.dir='rtl';arabic.maxLength=80;
      const values=document.createElement('input'); values.dataset.variantValues=String(index);values.value=[...new Set(data.rows.map(row=>row.values[index]).filter(Boolean))].join(', ');
      row.append(field(text('Option name (English)','اسم الاختيار بالإنجليزي'),name),field(text('Option name (Arabic)','اسم الاختيار بالعربي'),arabic),field(text('Values, separated by commas','القيم مفصولة بفاصلة'),values));target.append(row);
    });
  }
  function renderRows() {
    rows.replaceChildren();
    data.rows.forEach(row=>{
      const card=document.createElement('article');card.className='variant-combination-card';
      const heading=document.createElement('div');heading.className='variant-combination-heading';
      const image=document.createElement('img');image.alt='';image.hidden=!row.imageUrl;if(row.imageUrl)image.src=row.imageUrl;
      const title=document.createElement('strong');title.textContent=row.values.filter(Boolean).join(' / ')||text('New combination','اختيار جديد');
      heading.append(image,title);card.append(heading);
      const controls=document.createElement('div');controls.className='variant-combination-fields';
      data.options.forEach((option,index)=>{const value=input(row.values[index]||'',value=>{row.values[index]=value;title.textContent=row.values.filter(Boolean).join(' / ');});value.maxLength=100;value.required=data.enabled;controls.append(field(ar?option.nameAr||option.name:option.name,value));});
      const select=document.createElement('select');imageOptions(select,row.imageUrl);select.required=data.enabled;select.dataset.variantImage='';select.addEventListener('change',()=>{row.imageUrl=select.value;image.hidden=!select.value;if(select.value)image.src=select.value;sync();});controls.append(field(text('Image for this choice','صورة هذا الاختيار'),select));
      const stock=input(row.stock,value=>{row.stock=value;},'number');stock.max='1000000';stock.required=data.enabled;stock.dataset.variantStock='';
      const price=input(row.priceEgp,value=>{row.priceEgp=value;},'number');price.min='1';price.required=data.enabled;price.dataset.variantPrice='';
      const offer=input(row.salePriceEgp,value=>{row.salePriceEgp=value;},'number');offer.min='1';offer.dataset.variantOffer='';
      const validateOffer=()=>{offer.max=String(Math.max(1,Number(price.value)-1));};price.addEventListener('input',validateOffer);validateOffer();
      controls.append(field(text('Stock','المخزون'),stock),field(text('Regular price (EGP)','السعر العادي (جنيه)'),price),field(text('Offer price (optional)','سعر العرض (اختياري)'),offer));
      const titleAr=input(row.titleAr,value=>{row.titleAr=value;});titleAr.dir='rtl';titleAr.maxLength=500;controls.append(field(text('Arabic choice label','اسم الاختيار بالعربي'),titleAr));
      const active=document.createElement('input');active.type='checkbox';active.checked=row.available;active.addEventListener('change',()=>{row.available=active.checked;sync();});const activeLabel=field(text('Enabled','متاح'),active);activeLabel.className='variant-combination-active';
      const remove=document.createElement('button');remove.type='button';remove.className='text-link';remove.textContent=text('Remove combination','إزالة الاختيار');remove.addEventListener('click',()=>{data.rows=data.rows.filter(item=>item!==row);renderRows();renderOptions();});
      const actions=document.createElement('div');actions.className='variant-combination-actions';actions.append(activeLabel,remove);card.append(controls,actions);rows.append(card);
    });
    rebuildFilter();sync();
  }
  function newRow(values) { const priceEgp=Number(form.querySelector('[name="priceEgp"]')?.value)||1;const offer=Number(form.querySelector('[name="salePriceEgp"]')?.value)||null;return {values,priceEgp,salePriceEgp:offer&&offer<priceEgp?offer:null,stock:0,available:true,imageUrl:urls()[0]||'',titleAr:''}; }
  toggle.addEventListener('change',()=>{
    if(!toggle.checked&&data.rows.some(row=>row.id)){toggle.checked=true;status.textContent=text('Disable or remove individual combinations instead.','يمكنك إيقاف أو إزالة كل اختيار من الكارت الخاص به.');return;}
    data.enabled=toggle.checked;
    if(data.enabled){const legacy=form.querySelector('[data-manage-types]');if(legacy?.checked){legacy.checked=false;legacy.dispatchEvent(new Event('change'));}const colorVariants=form.querySelector('[data-color-variants]');if(colorVariants)colorVariants.value='[]';}
    renderRows();
  });
  root.querySelector('[data-add-variant-option]').addEventListener('click',()=>{if(data.options.length>=4)return;data.options.push({name:`Option ${data.options.length+1}`,nameAr:`اختيار ${data.options.length+1}`});data.rows.forEach(row=>row.values.push(''));renderOptions();renderRows();});
  root.querySelector('[data-generate-variants]').addEventListener('click',()=>{
    const groups=[...root.querySelectorAll('[data-variant-values]')].map(input=>[...new Set(input.value.split(/[,،\n]+/).map(value=>value.trim()).filter(Boolean))]);
    if(groups.some(group=>!group.length)||groups.reduce((total,group)=>total*group.length,1)>300){status.textContent=text('Enter option values. Maximum 300 combinations.','أدخل قيم الاختيارات. الحد الأقصى ٣٠٠ اختيار.');return;}
    const combinations=groups.reduce((rows,values)=>rows.flatMap(row=>values.map(value=>[...row,value])),[[]]);
    // When adding a new dimension, keep the old combination's stock on its
    // first listed value. All newly generated siblings start with zero stock.
    data.rows.forEach(row=>row.values.forEach((value,index)=>{if(!value)row.values[index]=groups[index][0];}));
    const added=combinations.filter(values=>!data.rows.some(row=>JSON.stringify(row.values)===JSON.stringify(values)));
    if(data.rows.length+added.length>300){status.textContent=text('Maximum 300 combinations.','الحد الأقصى ٣٠٠ اختيار.');return;}
    data.rows.push(...added.map(newRow));status.textContent=text('Existing stock stays with its first listed option. New combinations start with zero stock.','يبقى المخزون الحالي مع أول قيمة للاختيار الجديد. تبدأ التركيبات الجديدة بمخزون صفر.');renderRows();
  });
  root.querySelector('[data-add-variant-row]').addEventListener('click',()=>{if(data.rows.length>=300)return;data.rows.push(newRow(data.options.map(()=>'')));renderRows();});
  root.querySelector('[data-apply-variant-offer]').addEventListener('click',()=>{
    const raw=root.querySelector('[data-variant-bulk-offer]').value,value=raw===''?null:Number(raw), selected=data.rows.filter(visible);
    if(value!==null&&(!Number.isSafeInteger(value)||value<1||selected.some(row=>value>=row.priceEgp))){status.textContent=text('The offer must be below each selected regular price.','العرض يجب أن يكون أقل من السعر العادي لكل اختيار ظاهر.');return;}
    selected.forEach(row=>{row.salePriceEgp=value;});renderRows();
  });
  const bulkImage=root.querySelector('[data-variant-bulk-image]');
  root.querySelector('[data-apply-variant-image]').addEventListener('click',()=>{if(!urls().includes(bulkImage.value))return;data.rows.filter(visible).forEach(row=>{row.imageUrl=bulkImage.value;});renderRows();});
  search.addEventListener('input',sync);filter.addEventListener('change',sync);
  form.addEventListener('catalog:images-changed',()=>{imageOptions(bulkImage,bulkImage.value);renderRows();});
  form.addEventListener('submit',event=>{sync();if(!data.enabled)return;if(!data.rows.length||new Set(data.rows.map(row=>JSON.stringify(row.values))).size!==data.rows.length||data.rows.some(row=>row.values.some(value=>!value.trim())||!urls().includes(row.imageUrl))){event.preventDefault();status.textContent=text('Complete each unique combination and choose its image.','أكمل بيانات كل اختيار بدون تكرار وحدد صورته.');root.scrollIntoView({block:'center'});}});
  if(data.enabled){const legacy=form.querySelector('[data-manage-types]');if(legacy?.checked){legacy.checked=false;legacy.dispatchEvent(new Event('change'));}const colorVariants=form.querySelector('[data-color-variants]');if(colorVariants)colorVariants.value='[]';}
  imageOptions(bulkImage,'');renderOptions();renderRows();
})();
