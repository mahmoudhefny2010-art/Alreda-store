# Customer sign-in, carts, PWA and notifications

## Local setup

Copy the variable names from `.env.example` into the ignored local `.env` and fill secrets there. For Google Cloud OAuth, add the exact local redirect URI `http://127.0.0.1:666/auth/google/callback` to the Web application client. If `PORT` changes, change `GOOGLE_CALLBACK_URL` and the Google authorized redirect URI to the same value. Google ID tokens are validated against Google's signing keys, audience, issuer, nonce, expiry and verified email. Customer sessions use random opaque cookies; only SHA-256 token hashes are stored in PostgreSQL.

For OneSignal, set the app ID and REST API key on the server. The browser receives only the public app ID. Push permission is requested only after a customer explicitly presses the enable button, and notification preference defaults are transactional on and marketing off. A signed-in user's guest cart is merged after successful Google sign-in; price and stock are checked again by the order service.

Notification connection recovery: pressing Enable retries a failed SDK download or account login. Account retries reuse the initialized SDK. After recovery, press Enable again to grant browser permission. The account and welcome dialogs distinguish SDK loading, account linking, device registration, expired sessions and subscription persistence failures in both languages. Subscription change events are persisted only after SDK account login completes, and connection success is shown only after the server saves the subscription.

## Northflank setup

Set `DATABASE_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL` (the public HTTPS `/auth/google/callback` URL), a unique random `SESSION_SECRET`, and `ONESIGNAL_APP_ID` / `ONESIGNAL_REST_API_KEY` as runtime secrets. Configure the identical HTTPS callback in Google Cloud. Serve the app behind HTTPS; secure cookies and the PWA service worker require the production HTTPS origin. Keep OneSignal REST credentials server-side.

## Data migration and readiness

The additive migration `20261103000000_customer_auth_cart_notifications` creates customer sessions, persistent guest/customer carts, consent preferences, a deduplicated notification outbox and delivery attempts, and abandoned-cart reminders. It preserves existing users, products, orders and image records. This task did not run that migration against Neon. Review `npm run db:status` and the SQL, then schedule `npm run db:migrate` through the approved deployment process before enabling authentication, carts or notifications in Northflank. Do not run a reset command.

Checkout must remain disabled until staff enter real inventory counts and approve shipping rates and checkout origin. Existing product source availability is not stock. Online payment stays unavailable until a trusted provider adapter is configured. Push reminder timing defaults to 120 minutes and can be set to 15â€“10,080 minutes in the admin notification page. The browser's offline page is a navigation fallback only; checkout, account, API and admin responses are never cached.

The worker records each send attempt and retries provider failures with bounded backoff. OneSignal's send response records provider acceptance, not a guarantee that a device displayed the notification; an ambiguous timeout may be retried after lease expiry, so the provider could accept a duplicate if it accepted the first request but its response was lost.
