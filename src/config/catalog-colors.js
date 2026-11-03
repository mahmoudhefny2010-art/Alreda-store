const colorOptions = Object.freeze([
  { en: 'Black', ar: '\u0623\u0633\u0648\u062f', hex: '#202020' },
  { en: 'Silver', ar: '\u0641\u0636\u064a', hex: '#b9bec3' },
  { en: 'Rose Gold', ar: '\u0630\u0647\u0628\u064a \u0648\u0631\u062f\u064a', hex: '#c89480' },
  { en: 'Bronze', ar: '\u0628\u0631\u0648\u0646\u0632\u064a', hex: '#967044' },
  { en: 'Gold', ar: '\u0630\u0647\u0628\u064a', hex: '#c5a35c' },
  { en: 'Gray', ar: '\u0631\u0645\u0627\u062f\u064a', hex: '#808080' },
  { en: 'Antique', ar: '\u0623\u0646\u062a\u064a\u0643', hex: '#80664c' },
  { en: 'White', ar: '\u0623\u0628\u064a\u0636', hex: '#fafafa' },
  { en: 'Chrome', ar: '\u0643\u0631\u0648\u0645', hex: '#b9bec3' },
  { en: 'Beige', ar: '\u0628\u064a\u062c', hex: '#d9cbb8' },
  { en: 'Brown', ar: '\u0628\u0646\u064a', hex: '#805b40' },
  { en: 'Red', ar: '\u0623\u062d\u0645\u0631', hex: '#ad3030' },
  { en: 'Clear', ar: '\u0634\u0641\u0627\u0641', hex: '#f1f4f4' },
]);

const aliases = new Map([
  ['grey', 'Gray'], ['matte black', 'Black'], ['black matte', 'Black'],
  ['gold mat', 'Gold'], ['matte gold', 'Gold'], ['silver mat', 'Silver'], ['matte silver', 'Silver'],
  ['copper', 'Rose Gold'], ['stainless steel', 'Silver'], ['antique brass', 'Antique'],
]);
const byName = new Map(colorOptions.flatMap(color => [[color.en.toLowerCase(), color], [color.ar, color]]));
for (const [alias, name] of aliases) byName.set(alias, colorOptions.find(color => color.en === name));
const matchNames = [...byName.keys()].sort((a, b) => b.length - a.length);

function resolveColorSwatches(value) {
  const seen = new Set();
  return String(value || '').split(/[,;|/]+/).map(part => part.trim()).filter(Boolean).flatMap(part => {
    const normalized = part.toLowerCase().replace(/\s+/g, ' ');
    let color = byName.get(normalized);
    if (!color) {
      const found = matchNames.find(name => new RegExp(`(?:^|\\b)${name.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}(?:$|\\b)`, 'i').test(normalized));
      color = found ? byName.get(found) : null;
    }
    if (!color || seen.has(color.en)) return [];
    seen.add(color.en);
    return [{ ...color, value: part }];
  });
}

module.exports = { colorOptions, resolveColorSwatches };
