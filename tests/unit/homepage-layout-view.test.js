const ejs = require('ejs');
const path = require('node:path');

describe('homepage layout admin view', () => {
  it('renders section controls and category assignments without a temporal-dead-zone error', async () => {
    const html = await ejs.renderFile(path.join(process.cwd(), 'src/views/admin/homepage-layout.ejs'), {
      a: key => key,
      sections: [
        { id: 'section-1', title_en: 'Collections', title_ar: 'المجموعات', slug: 'collections' },
        { id: 'section-2', title_en: 'Featured', title_ar: 'مميزة', slug: 'featured' },
      ],
      categories: [
        { id: 'category-1', home_section_id: 'section-1', homepage_order: 0, name: 'Mirrors', name_ar: 'مرايا', slug: 'mirrors', image_url: '' },
        { id: 'category-2', home_section_id: null, homepage_order: 0, name: 'Hidden category', name_ar: 'تصنيف مخفي', slug: 'hidden', image_url: '' },
      ],
    });

    expect(html).toContain('data-home-section data-section-id="section-1"');
    expect(html).toContain('data-home-section data-section-id="section-2"');
    expect(html).toContain('data-home-category data-category-id="category-1"');
    expect(html).toContain('data-home-category data-category-id="category-2"');
    expect(html).toContain('data-category-section');
    expect(html).toContain('value="section-2"');
    expect(html).toContain('data-save-layout');
    expect(html).toContain('action="/admin/catalog/homepage/sections"');
  });
});
