# Alreda Store

Independent commerce platform using CommonJS Node.js, Express, EJS, custom CSS and vanilla JavaScript. Imported product storefront, prepared Cloudinary integration and verified Neon/Prisma connectivity. Authentication, cart and checkout remain unimplemented; admin is informational.

## Run locally

Use Node.js 24 (verified with 24.13.1), or a compatible supported version satisfying package.json.

```sh
npm install
# Only for a new setup; preserve an existing .env
cp .env.example .env
npm run build
npm run dev
```

For a new Windows PowerShell setup use `Copy-Item .env.example .env` only if no local .env exists and `npm.cmd` if execution policy blocks `npm.ps1`. The environment file is optional for the local defaults. Visit http://127.0.0.1:666 and http://127.0.0.1:666/admin. `npm start` runs without file watching; Ctrl+C stops the server. The host defaults to loopback locally and 0.0.0.0 in production. Production requires a valid runtime DATABASE_URL.

## Verification

```sh
npm run lint
npm test
npm run test:e2e
```

Browser tests use installed Google Chrome and start their own server on port 3100. Checkout tests additionally start a disposable local PostgreSQL cluster and a loopback test server on ephemeral ports; no real Neon orders are created. Screenshots are saved under ignored `test-results/`. EJS renders at runtime; there is no frontend compilation; `npm run build` generates Prisma Client without database credentials. `npm start` is the runtime startup command.

## Scope and safety

`/admin` is now a protected database-backed order dashboard. No default authentication adapter or accounts are created, so it returns 401 until verified login is connected. Checkout is disabled by default; authentication, reviewed schema changes, real inventory and catalog mapping are required before activation. See [durable order workflow](docs/order-workflow.md) for confirmation guarantees, recovery, tests and remaining production requirements. Catalog pages retain their imported local data.

See [Neon/Prisma verification and Northflank deployment](docs/neon-prisma.md) for database commands, migration ownership and deployment requirements.

See [implementation plan](docs/implementation-plan.md), [architecture](docs/architecture.md), [database design](docs/database.md), [routes](docs/routes.md), [design system](docs/design-system.md) and [progress](docs/progress.md).
