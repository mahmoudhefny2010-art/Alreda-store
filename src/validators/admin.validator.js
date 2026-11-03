const { z } = require('zod');
const cloud = require('../config/cloudinary-media.json').cloudName;
const { colorOptions } = require('../config/catalog-colors');
const text = max => z.string().trim().max(max).default('');
const money = z.coerce.number().int().min(1).max(10000000);
const imageUrl = z.string().trim().max(2048).refine(value => {
  try { const url = new URL(value); return url.protocol === 'https:' && url.hostname === 'res.cloudinary.com' && !url.username && !url.password && url.pathname.startsWith(`/${cloud}/image/upload/`); } catch { return false; }
});
const bilingual = { name: z.string().trim().min(1).max(120), nameAr: z.string().trim().min(1).max(160), description: text(8000), descriptionAr: text(10000) };
const colorVariantSchema = z.object({ color: z.enum(colorOptions.map(color => color.en)), imageUrl: z.string().trim().max(2048), stock: z.coerce.number().int().min(0).max(1000000).default(0), priceEgp: z.preprocess(value => value === '' || value === undefined ? null : value, money.nullable()), salePriceEgp: z.preprocess(value => value === '' ? null : value, money.nullable().optional()) }).strict();
const presentationSchema = z.object({
  hoverImage: z.string().max(2048).default(''), mobileImage: z.string().max(2048).default(''),
  manageTypes: z.boolean().default(false),
  types: z.array(z.object({ en: z.string().trim().min(1).max(80), ar: z.string().trim().min(1).max(100),
    imageUrl: z.string().max(2048), stock: z.coerce.number().int().min(0).max(1000000),
    priceEgp: money }).strict()).max(30).default([]),
}).strict();
const variantEditorSchema = z.object({ enabled: z.boolean().default(false),
  options: z.array(z.object({ name: z.string().trim().min(1).max(60), nameAr: z.string().trim().max(80).default('') }).strict()).min(1).max(4),
  rows: z.array(z.object({ id: z.uuid().optional(), values: z.array(z.string().trim().min(1).max(100)).min(1).max(4),
    priceEgp: money, salePriceEgp: z.preprocess(value => value === '' || value === undefined ? null : value, money.nullable()),
    stock: z.coerce.number().int().min(0).max(1000000), available: z.boolean().default(true), imageUrl: z.string().max(2048), titleAr: z.string().trim().max(500).default(''),
  }).strict()).max(300),
}).strict().superRefine((value, ctx) => {
  if (!value.enabled) return;
  if (!value.rows.length || new Set(value.options.map(option => option.name.toLowerCase())).size !== value.options.length) ctx.addIssue({ code:'custom', message:'INVALID_VARIANT_MATRIX' });
  const ids = value.rows.map(row => row.id).filter(Boolean);
  if (new Set(ids).size !== ids.length || new Set(value.rows.map(row => JSON.stringify(row.values))).size !== value.rows.length) ctx.addIssue({code:'custom',message:'DUPLICATE_VARIANT'});
  for (const row of value.rows) if (row.values.length !== value.options.length || row.salePriceEgp != null && row.salePriceEgp >= row.priceEgp) ctx.addIssue({code:'custom',message:'INVALID_VARIANT_PRICE_OR_OPTIONS'});
  if (value.rows.reduce((sum,row)=>sum+(row.available?row.stock:0),0)>1000000) ctx.addIssue({code:'custom',message:'INVALID_TOTAL_STOCK'});
});
const productSchema = z.object({ ...bilingual, id: z.union([z.uuid(), z.literal('')]).default(''), categoryId: z.uuid(), priceEgp: money,
  expectedUpdatedAt: z.union([z.iso.datetime({ offset: true }), z.literal('')]).default(''),
  salePriceEgp: z.union([z.literal(''), money]).optional().transform(value => value === '' || value === undefined ? null : value),
  stock: z.coerce.number().int().min(0).max(1000000), color: text(80), colorAr: text(100), colorVariants: z.string().trim().max(40000).default('[]'), type: text(100), typeAr: text(120), presentation: z.string().max(50000).default('{}'), variantEditor: z.string().max(200000).default(''), available: z.enum(['on', 'true']).optional().transform(Boolean), images: z.string().trim().max(25000) }).strict().superRefine((value, ctx) => {
  let matrixEnabled = false; try { matrixEnabled = Boolean(JSON.parse(value.variantEditor || '{}').enabled); } catch { /* parsed with a clear error below */ }
  if (!matrixEnabled && value.salePriceEgp !== null && value.salePriceEgp >= value.priceEgp) ctx.addIssue({ code: 'custom', path: ['salePriceEgp'], message: 'OFFER_PRICE_MUST_BE_LOWER' });
}).transform(value => {
  const imageUrls = z.array(imageUrl).min(1).max(12).parse(value.images.split(/\r?\n/).map(line => line.trim()).filter(Boolean));
  let colorVariants;
  try { colorVariants = z.array(colorVariantSchema).max(colorOptions.length).parse(JSON.parse(value.colorVariants)); } catch { throw new Error('INVALID_COLOR_VARIANTS'); }
  if (new Set(colorVariants.map(item => item.color)).size !== colorVariants.length || colorVariants.some(item => !imageUrls.includes(item.imageUrl))) throw new Error('INVALID_COLOR_VARIANTS');
  if (colorVariants.map(item => item.color).join(', ').length > 80 || colorVariants.map(item => colorOptions.find(color => color.en === item.color)?.ar).join(', ').length > 100) throw new Error('INVALID_COLOR_VARIANTS');
  const presentation = presentationSchema.parse(JSON.parse(value.presentation));
  const variantEditor = value.variantEditor ? variantEditorSchema.parse(JSON.parse(value.variantEditor)) : null;
  if (variantEditor?.enabled && variantEditor.rows.some(row => !imageUrls.includes(row.imageUrl))) throw new Error('INVALID_VARIANT_IMAGE');
  const assignedImages = [presentation.hoverImage, presentation.mobileImage, ...presentation.types.map(item => item.imageUrl)].filter(Boolean);
  if (assignedImages.some(url => !imageUrls.includes(url))) throw new Error('INVALID_PRESENTATION_IMAGE');
  if (new Set(presentation.types.map(item => item.en.toLowerCase())).size !== presentation.types.length) throw new Error('DUPLICATE_PRODUCT_TYPE');
  if (presentation.manageTypes && !presentation.types.length) throw new Error('PRODUCT_TYPE_REQUIRED');
  for (const color of (variantEditor?.enabled ? [] : colorVariants)) {
    const base = color.priceEgp ?? (presentation.manageTypes ? Math.min(...presentation.types.map(type => type.priceEgp)) : value.priceEgp);
    if (color.salePriceEgp != null && color.salePriceEgp >= base) throw new Error('OFFER_PRICE_MUST_BE_LOWER');
  }
  return { ...value, imageUrls, colorVariants, presentation, variantEditor };
});
const categorySchema = z.object({ ...bilingual, name: z.string().trim().min(1).max(80), nameAr: z.string().trim().min(1).max(100), slug: z.string().trim().max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/), imageUrl, homeSectionId: z.union([z.uuid(), z.literal('')]).optional().transform(value => value || null) }).strict();
const homeSectionSchema = z.object({ titleEn: z.string().trim().min(1).max(100), titleAr: z.string().trim().min(1).max(120), slug: z.string().trim().min(2).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/) }).strict();
const homepageLayoutSchema = z.object({
  sections: z.array(z.object({ id: z.uuid(), titleEn: z.string().trim().min(1).max(100), titleAr: z.string().trim().min(1).max(120) }).strict()).min(1).max(30),
  categories: z.array(z.object({ id: z.uuid(), sectionId: z.union([z.uuid(), z.null()]), nameEn: z.string().trim().min(1).max(80), nameAr: z.string().trim().min(1).max(100) }).strict()).max(500),
}).strict();
const discountSchema = z.object({ name: bilingual.name, nameAr: z.string().trim().min(1).max(160), mode: z.enum(['PERCENT', 'FIXED']), amount: money, scope: z.enum(['ALL', 'PRODUCT', 'CATEGORY', 'TYPE', 'COLOR']), target: text(160), startsAt: z.iso.datetime({ offset: true }).transform(value => new Date(value)), endsAt: z.iso.datetime({ offset: true }).transform(value => new Date(value)) }).strict().superRefine((value, ctx) => {
  if (value.mode === 'PERCENT' && value.amount > 100) ctx.addIssue({ code: 'custom', path: ['amount'], message: 'DISCOUNT_PERCENT_TOO_HIGH' });
  if (value.endsAt <= value.startsAt) ctx.addIssue({ code: 'custom', path: ['endsAt'], message: 'DISCOUNT_END_BEFORE_START' });
  if (value.scope !== 'ALL' && !value.target) ctx.addIssue({ code: 'custom', path: ['target'], message: 'DISCOUNT_TARGET_REQUIRED' });
  if (['PRODUCT', 'CATEGORY'].includes(value.scope) && !z.uuid().safeParse(value.target).success) ctx.addIssue({ code: 'custom', path: ['target'], message: 'DISCOUNT_TARGET_INVALID' });
});
const offerPriceSchema = z.object({ salePriceEgp: money }).strict();
const colorOfferSchema = z.object({ color: z.enum(colorOptions.map(color => color.en)), salePriceEgp: z.preprocess(value => value === '' ? null : value, money.nullable()) }).strict();
const grantSchema = z.object({ email: z.email().max(254).transform(value => value.trim().toLowerCase()), role: z.enum(['admin', 'catalog_manager', 'order_manager']) }).strict();
module.exports = { productSchema, variantEditorSchema, categorySchema, homeSectionSchema, homepageLayoutSchema, discountSchema, offerPriceSchema, colorOfferSchema, grantSchema };
