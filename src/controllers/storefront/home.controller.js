const { z } = require('zod');
const { categories: localCategories } = require('../../config/storefront-preview');
const { getDatabaseCatalog } = require('../../services/catalog.repository');
const { categoryName, translate } = require('../../config/storefront-i18n');
const querySchema = z.object({ collection: z.enum(localCategories.map(category => category.slug)).optional() });
exports.index = async (req, res, next) => {
  const query = querySchema.safeParse(req.query);
  if (!query.success) return res.status(400).render('layouts/storefront', {
    title: translate(req.locale, 'unavailableCollection'), contentView: '../errors/500',
    message: translate(req.locale, 'selectCollectionError'),
  });
  if (query.data.collection) return res.redirect(302, `/collections/${query.data.collection}`);
  try {
    const data = await getDatabaseCatalog();
    const aliases = [...data.byCategory.values()].filter(category => category.group === 'legacy');
    const sections = [...(data.sections || [])].filter(section => section.is_active !== false).sort((a, b) => a.display_order - b.display_order);
    const visible = [...data.categories].sort((a, b) => (a.homeOrder ?? 1000) - (b.homeOrder ?? 1000));
    const categories = [...visible, ...aliases];
    const localizedCategories = categories.map(category => ({ ...category, name: categoryName(category, req.locale) }));
    const collectionGroups = sections.map((section, index) => ({
      id: index === 0 ? 'collections' : `homepage-section-${section.id}`,
      titleId: `homepage-section-title-${section.id}`,
      title: categoryName({ name: section.title_en || section.titleEn, titleEn: section.title_en || section.titleEn, titleAr: section.title_ar || section.titleAr }, req.locale),
      type: section.slug === 'home-secondary' || section.slug === 'secondary' ? 'secondary' : 'primary',
      categories: visible.filter(category => category.homeSectionId === section.id || category.group === section.slug)
        .sort((a, b) => (a.homeOrder ?? 1000) - (b.homeOrder ?? 1000))
        .map(category => ({ ...category, name: categoryName(category, req.locale) })),
    })).filter(group => group.categories.length);
    res.render('layouts/storefront', { title: translate(req.locale, 'collectionsTitle'),
      contentView: '../storefront/home', categories: localizedCategories, collectionGroups });
  } catch (error) { return next(error); }
};
