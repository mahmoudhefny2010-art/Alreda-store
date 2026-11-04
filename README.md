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

Browser tests use installed Google Chrome and start their own server on port 3100; set `PLAYWRIGHT_PORT` to an unused port when needed. Checkout tests additionally start a disposable local PostgreSQL cluster and a loopback test server on ephemeral ports; no real Neon orders are created. Screenshots are saved under ignored `test-results/`. EJS renders at runtime; there is no frontend compilation; `npm run build` generates Prisma Client without database credentials. `npm start` is the runtime startup command.

## Scope and safety

`/admin` is protected and uses the configured Google sign-in and admin roles. Orders and catalog data are stored in PostgreSQL. Checkout availability depends on delivery areas, live stock and payment settings configured by an administrator. See [order workflow](docs/order-workflow.md) for confirmation and recovery details.

See [Neon/Prisma verification and Northflank deployment](docs/neon-prisma.md) for database commands, migration ownership and deployment requirements.

## Vercel

The root `app.js` exports the existing Express application without a listener or timers. `npm run build` generates Prisma Client and copies public runtime assets to Vercel's CDN `public/assets/` paths; EJS views and catalog JSON are explicitly included in the function. Local development still uses `src/server.js`.

Set secrets in the appropriate Vercel environment, not in uploaded `.env` files. Preview tests require a separate test database; a display-only Preview can use `DATABASE_REQUIRED=false`, no database URL, `CHECKOUT_ENABLED=false`, and `INSTAPAY_ENABLED=false`. Keep Google and OneSignal disabled there until test credentials and HTTPS origins are configured. Runtime Neon connections should use the pooled URL and a conservative `DATABASE_POOL_MAX`; `DIRECT_URL` is for reviewed migration commands only. Build never applies migrations.

Background work is exposed through authenticated `GET /api/jobs/run` with `CRON_SECRET`. The configured cron checks daily at 07:00 UTC (Hobby invocation can occur within that hour); reminders therefore run daily rather than exactly two hours after abandonment. Cron runs only on Production deployments. Hobby is for non-commercial personal use, so live store transactions require a permitted plan. Uploads larger than Vercel's request limit, outside-area delivery quotations and the unimplemented analytics/Excel features remain limitations; a display-only Preview does not verify those flows. On Vercel, verified admin media recovery records use the existing Neon audit table; local imports retain their file journal.

HTTP routes and controllers live in `src/routes` and `src/controllers`; services assemble pages and business operations, repositories own persistence, and EJS views live in `src/views`. Edit assets under `src/public`; `public` is generated deployment output. The storefront uses Neon when configured and the imported snapshot for database-free development. Google sign-in, cart/favorites APIs, checkout/order recovery, and role-protected admin routes are implemented and tested with synthetic accounts.

See [database design](docs/database.md), [Cloudinary media setup](docs/cloudinary-media.md), [delivery and notifications](docs/delivery-and-push.md), [InstaPay review](docs/instapay.md), and [performance verification](docs/performance.md).
