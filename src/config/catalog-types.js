const typeOptions = [
  ['Single', 'مفرد'], ['Double', 'مزدوج'], ['Tumbler holder', 'حامل كوب'],
  ['Soap dish', 'طبق صابون'], ['Paper holder', 'حامل مناديل'],
  ['Closed towel ring', 'حلقة مناشف مغلقة'], ['Open towel ring', 'حلقة مناشف مفتوحة'],
  ['Wire soap holder', 'حامل صابون سلك'], ['Clothes hook', 'علاقة ملابس'],
  ['Glass shelf holder', 'حامل رف زجاج'], ['Towel holder', 'حامل مناشف'],
  ['Toilet brush', 'فرشاة مرحاض'], ['Complete set', 'طقم كامل'],
].map(([en, ar]) => ({ en, ar }));
module.exports = { typeOptions };
