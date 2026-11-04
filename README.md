# Alreda Store

Full-stack Alreda Store using CommonJS Node.js, Express, EJS, PostgreSQL/Neon, Prisma, Cloudinary and vanilla JavaScript. It includes a bilingual product catalog, customer Google sign-in, shopping cart and checkout flows, plus protected admin tools for orders and catalog management. Live checkout requires valid database, delivery and payment configuration.

## Run locally

Use Node.js 24 (verified with 24.13.1), or a compatible supported version satisfying package.json.

```sh
npm ci
# Only for a new setup; preserve an existing .env
cp .env.example .env
npm run build
npm run dev
```

For a new Windows PowerShell setup use `Copy-Item .env.example .env` only if no local `.env` exists and `npm.cmd` if execution policy blocks `npm.ps1`. Set required credentials and service settings in `.env`; never commit that file. Product photos are served from the Cloudinary manifest, so configure the matching Cloudinary account values from `.env.example`. Visit http://127.0.0.1:666 and http://127.0.0.1:666/admin. `npm start` runs without file watching; Ctrl+C stops the server. The host defaults to loopback locally and 0.0.0.0 in production. Production requires a valid runtime `DATABASE_URL` and Cloudinary configuration.

## Verification

```sh
npm run lint
npm test
npm run test:e2e
```

Browser tests use installed Google Chrome and start their own server on port 3100. Checkout tests additionally start a disposable local PostgreSQL cluster and a loopback test server on ephemeral ports; no real Neon orders are created. Screenshots are saved under ignored `test-results/`. EJS renders at runtime; there is no frontend compilation; `npm run build` generates Prisma Client without database credentials. `npm start` is the runtime startup command.

## Scope and safety

`/admin` is protected and uses the configured Google sign-in and admin roles. Orders and catalog data are stored in PostgreSQL. Checkout availability depends on delivery areas, live stock and payment settings configured by an administrator. See [order workflow](docs/order-workflow.md) for confirmation and recovery details.

See [Neon/Prisma verification and Northflank deployment](docs/neon-prisma.md) for database commands, migration ownership and deployment requirements.

See [architecture](docs/architecture.md), [database design](docs/database.md), [routes](docs/routes.md), [design system](docs/design-system.md), [Cloudinary media setup](docs/cloudinary-media.md), [delivery and notifications](docs/delivery-and-push.md), and [InstaPay review](docs/instapay.md).
