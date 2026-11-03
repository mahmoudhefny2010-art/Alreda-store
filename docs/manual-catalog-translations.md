# Manual English and Arabic catalog

All 237 captured products have manually authored English and Arabic names/descriptions. 229 existing Neon rows needed changes. The apply command wrote only name, name_ar, description and description_ar, and verified saved values after commit. It did not alter prices, stock, orders or media. Current results are in manual-translation-report.json.

The reviewed phrase dictionary is scripts/catalog-import/manual-description-translations.json; general catalog terminology is src/config/manual-catalog-terms.json. No translation API, network translation request or translation key is needed. Model identifiers and technical codes (ABS, SUS 304, IPX1, CE, LED and source model codes) remain unchanged. Source warranties, dimensions, materials and even conflicting source specifications are preserved rather than invented or silently corrected.

```powershell
# Prepare a local plan; never calls an external translation provider:
npm.cmd run catalog:translate:manual
# After reviewing a plan, apply names/descriptions with identity/edit checks:
npm.cmd run catalog:translate:manual -- --execute
```

Before any database update, the operator command writes product-only backups under ignored data/imports/alreda/manual-translation/. It validates required locales and lengths, source identities, administrator-edit conflicts and translated prose coverage. Database writes are atomic and repeatable. Active product snapshots update after persistent verification. If source prose changes, catalog:details refuses to overwrite the manual translations and requires review. The stored original-description hash records provenance.

New products, categories and discounts in the distribution admin panel must be entered in both languages manually. Paired optional fields such as descriptions, color and type must both be filled when either language is supplied. There is no promise that arbitrary future text is translated automatically. Google Sign-In continues using its existing OAuth configuration.
