# Shopping activation status

The existing Neon connection is working. The customer session/cart/notification migration was applied on 2026-11-02 after checking the two earlier migration checksums and testing apply, empty rollback and reapply locally. Three root-project migrations are now applied with no incomplete entries. Existing products and orders were not rewritten; no real customer order was created during verification.

Stocked, available, database-backed products without selectable variants use the persistent cart API. Guest carts merge after verified Google login. Checkout prefills saved quantities. Buy Now navigates only after the cart has been saved successfully, and remains disabled while checkout is disabled. Order confirmation still requires commit and retrieval through the admin repository, with idempotent retry reconciliation.

The old unconditional “Shopping is not connected yet” message has been replaced with the actual item state: catalog-only, inventory not configured, unavailable, or unsupported selectable variants. No stock or delivery fees are invented.

## Required operator setup

1. Set actual stock quantities in PostgreSQL. Current inventory is unconfigured. A public source availability snapshot is not a stock count.
2. Supply approved whole-EGP delivery fees per city in CHECKOUT_SHIPPING_RATES and keep CHECKOUT_ORIGIN matched to the application origin.
3. Verify Google sign-in with the configured client ID/secret and exact callback URI. Credentials are present locally, but a real Google account sign-in was not performed by the automated checks.
4. Explicitly provision the intended verified administrator account. Never make the first visitor an administrator automatically. The separate lightweight distribution contains the additional reviewed team-role management migration and bootstrap instructions; those additional features have not been migrated into the root application.
5. Only enable CHECKOUT_ENABLED after the stock, authentication, administrator and shipping setup is complete. Online payment stays unavailable until a trusted provider adapter is configured.

Run `npm run shopping:check` to see read-only aggregate readiness. Exit code 1 means setup is incomplete, not that data was deleted. The command prints no credentials, user records or product records.

Multi-variant/option purchases remain deliberately unsupported by the current product-only cart/order model. This needs variant-aware persistence and inventory handling before enabling purchases for those products; setting parent stock alone does not enable it. Their option selection and image preview still work on product details. Do not remove this guard to simulate a connected store.

The database migration enables persistent cart/session storage; it does not make the checkout production-ready. Stock, shipping, administrator setup and live provider verification remain required.
