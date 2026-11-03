# Delivery prices and push notification controls

## Admin usage

Open **Delivery prices** (`/admin/delivery`) with an account that has order-management permission.

- Choose one fee for all enabled areas, or a different fee per area.
- Enable the areas you deliver to, edit their English/Arabic names, and add areas as needed.
- A fee of zero is free delivery. Disabled areas do not appear at checkout.
- Save to activate the database configuration. Existing environment prices are the fallback only until a database configuration has been saved.
- Existing orders keep their original delivery fee. New submissions read the current fee on the server; changed totals are rejected atomically rather than silently charged. Retrying a committed order reconciles its idempotency key before applying newer prices.

Checkout still requires the existing verified identity, stock, origin and enabled-checkout configuration. Delivery settings do not enable checkout or fabricate inventory. An unreadable/invalid saved policy fails closed; it never silently falls back to a cheaper fee. No enabled areas means no new supported deliveries.

Open **Notifications** (`/admin/notifications`) to compose a push message:

1. Select all eligible subscribers, customers with an active cart, or customers with previous orders.
2. Write English and Arabic titles/messages, or select an editable offer/new-product starter.
3. Choose a local store destination, inspect the preview, and review the audience.
4. Queue the message with the separate confirmation action.

Only active, signed-in customers with marketing consent and a stored device subscription are included. Eligibility is rechecked before each provider attempt. Audience counts are estimates and may change before processing. Maximum campaign size is 5,000 customers; select a smaller audience if necessary. The composer disables sending when there are no eligible customers or when OneSignal configuration is absent.

The automatic templates cover order received, order status changed, and abandoned carts. Each can be enabled/disabled and edited independently. `{reference}` inserts an order reference and `{status}` inserts the localized status. Order messages require transactional consent; abandoned-cart reminders require marketing consent. Saving templates never sends a campaign. Disabling abandoned-cart reminders also stops new reminder scheduling.

## Persistence and delivery behavior

The existing `site_settings` table stores `delivery_configuration`, `push_template:<event>`, and campaign idempotency receipts. The existing outbox/attempt tables process and record deliveries. No schema change is required. Admin settings/campaign operations validate with Zod, check same-origin requests and recheck the acting user's permission inside the transaction. Audit events contain action/record identifiers, not message bodies or credentials.

Campaign queueing commits recipients and its idempotency receipt in one transaction, protected by an advisory lock. Browser retries with the same key reuse the receipt; a changed message on that key is rejected. OneSignal requests use the outbox UUID as their [provider idempotency key](https://github.com/OneSignal/onesignal-node-api/blob/main/DefaultApi.md) so provider retries use the same request identity. A successful HTTP response without a message ID is treated as a failed provider attempt.

**Queued is not delivered.** A `SENT` attempt means the provider accepted the request; it does not prove the device displayed it. Skipped/failed attempts appear in history. A missing provider configuration prevents campaign queueing and does not expose credentials.

## Verification

Tests use a disposable local PostgreSQL database, synthetic accounts/subscriptions and a fake push provider. They cover authorization, persistent rates, stale total rollback, existing-order reconciliation after a fee change, audience filtering, opt-out checks, campaign retry deduplication, custom templates, disabled templates, safe links and provider receipts. Browser tests cover desktop/mobile delivery editing, Arabic composition, preview/review and a separate queue action. No shared database records or real notifications were created during verification.

Broader order regression tests still include the existing cart injection failure and outdated raw payment-code assertion. They are reported separately from the passing feature checks; this update does not declare the whole checkout production-ready.

A read-only Neon check on 2026-11-03 confirmed all six required existing tables are present. No migration or shared-record update was performed. Final feature checks: 10 unit/integration tests and 3 browser tests passed, alongside lint and build. The broader order suite retained its two previously reported failures.
