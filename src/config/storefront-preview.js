// Homepage groups follow the approved reference; discovery alone does not approve a homepage category.
const { categories: discovered, byCategory } = require('../services/catalog.repository');
const order = require('./collection-preview.json').filter(category => category.group !== 'legacy').map(category => category.slug);
const visible = [...discovered].sort((a, b) => {
  const first = order.indexOf(a.slug); const second = order.indexOf(b.slug);
  return (first < 0 ? 1000 : first) - (second < 0 ? 1000 : second);
});
const categories = Object.freeze([...visible, ...[...byCategory.values()].filter(category => category.group === 'legacy')]);
const collectionGroups = Object.freeze(['primary', 'secondary'].map((type, index) => ({
  id: ['collections', 'more-collections'][index], titleId: ['collections-title', 'more-collections-title'][index],
  title: 'Collections', type,
  categories: visible.filter(category => category.group === type),
})).filter(group => group.categories.length));
module.exports = { categories, collectionGroups };
