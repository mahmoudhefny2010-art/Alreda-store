# Architecture

## Current foundation

`src/server.js` loads dotenv, validates configuration with Zod and starts the HTTP server. `src/app.js` exports a separately testable application factory. It configures Helmet, bounded body parsers, absolute static paths, EJS, routing, 404 and centralized errors, in that order. Startup probes the configured database before listening; shutdown closes the server and database pool with a bounded timeout. See [Neon/Prisma deployment](neon-prisma.md).

Request flow: router → controller → EJS layout → page and shared partials → HTML response. The storefront and admin have distinct controllers and layouts. Only controller-owned template paths are included. User input is never spread into template options. EJS escaped interpolation is used for values; raw output is reserved for trusted template includes.

Implemented folders: config, routes/storefront, routes/admin, controllers/storefront, controllers/admin, middleware, views/layouts, views/partials, views/storefront, views/admin, views/errors, public/css/base and public/js. Tests are separated into unit, integration and E2E. Services, repositories, validators and Prisma configuration now support catalog/media boundaries and the existing Neon database connection. Catalog reads still use the imported local snapshot.

## Order workflow

The protected order dashboard and checkout endpoints use controllers ? order service ? Prisma repository. Transaction-scoped idempotency locks, row-locked pricing/stock and post-commit shared admin retrieval protect confirmation. Unknown outcomes remain pending and reconcile using the original key. Authentication is an explicit internal adapter with no default bypass. Checkout remains disabled pending schema authorization, real stock and catalog mapping; online payments require a trusted server adapter. See [order workflow](order-workflow.md).

## Future modules

The target is MVC + services + repositories: HTTP router → validation/auth middleware → controller → service → repository/Prisma → PostgreSQL. Business rules and transactions belong to services. Controllers must not query the database. The two applications share services and one database. Product, category, inventory, promotion, cart, checkout, order, content and analytics modules will be introduced in roadmap order.

## Authentication design (planned, not implemented)

Argon2id passwords, PostgreSQL-backed Express sessions, session regeneration on login, session destruction on logout, secure/HttpOnly/SameSite cookies, CSRF protection and rate-limited credential endpoints. Verified sessions determine the acting user. Admin role/permission checks must run server-side before every admin operation. User-owned queries must include ownership constraints. No production default administrator credentials.

## Errors and security

Helmet supplies security headers and a self-only script policy. Local development disables forced HTTPS upgrade; production enables it. Configuration failures disclose field names only. Client errors render generic 400/413 pages; internal errors return 500 and log only a fixed event and status. No stack traces, request content, secrets or personal data are logged. Unknown paths render 404 without reflecting the URL. No account/login flows are implemented. Order mutation endpoints are fail-closed by default, require verified identity, and use atomic database persistence plus post-commit admin-repository verification. Existing Neon data is preserved.

## Documentation references

Cloudinary media boundary: validated server-only SDK configuration, guarded upload middleware, reusable media service, injected authorization/repository ports, local reconciliation journal and optional catalog-delivery mapping. No media mutation endpoints are publicly mounted. See [cloudinary-media.md](cloudinary-media.md) for the persistence contract and deployment/configuration limits.

- [Express 5 error handling](https://expressjs.com/en/guide/error-handling/): async rejections reach error middleware automatically.
- [Express static files](https://expressjs.com/en/starter/static-files/): absolute paths avoid launch-directory coupling.
- [EJS documentation](https://ejs.co/#docs): CommonJS rendering, includes, escaping and Express integration.
- [Alreda reference](https://alredastore.com/): business niche and category-based shopping reference. No products or claims have been copied into this placeholder.
