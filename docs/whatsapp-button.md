# WhatsApp contact component

The storefront uses `src/views/partials/whatsapp-button.ejs`, `src/public/css/components/whatsapp-button.css` and `src/public/js/whatsapp-button.js`.

## Configuration

Set `WHATSAPP_PHONE` in the ignored local `.env` file or deployment environment, using country-code digits. The previous configured contact was migrated to local `.env`; no real number is embedded in templates or JavaScript. Set `WHATSAPP_GREETING` to customize the predefined message. Restart the server after changing environment values. A missing/blank phone disables the component instead of creating a broken link. Zod validates the number and greeting; URLSearchParams encodes the message. The destination is fixed to https://wa.me. No messages are sent automatically.

## Behavior

- Desktop: 44px transparent hit area, 20px from right and bottom. Mobile at 760px and below: 40px hit area, 14px edges, with a 44px effective touch area.
- Following the user's transparent-icon correction, the visible asset is a green #25D366 WhatsApp glyph with no background or badge shadow. The existing brand vector from https://cdn.jsdelivr.net/npm/simple-icons@16/icons/whatsapp.svg was exported as a 96px PNG with alpha transparency, displayed at 28px desktop / 24px mobile. The exported asset contains no opaque white pixels. The sliding white label ends before the glyph so it never creates a white background behind the icon.
- On window load, wait 400ms, slide the Contact Us label left for 450ms, hold it fully exposed for 2000ms, then slide it behind the icon for 450ms. CSS uses ease-in-out transitions. The icon never scales or animates across the page.
- Intro runs once per page load. Mouse hover or keyboard focus takes control of the label and cancels pending intro timers; leaving/blur hides it. No touch hover requirement.
- Reduced-motion preference skips the intro and removes transitions; hover/focus still shows the label instantly.
- Label is aria-hidden and pointer-events:none. The link has an accessible name, visible keyboard focus, safe new-tab attributes and a greeting URL.
- A requestAnimationFrame-throttled scroll/resize check lifts the fixed button above the visible footer with 12px clearance. It stays at normal edge offsets otherwise; long footers are clamped to keep the button onscreen. Footer resize is observed as well. This collision adjustment does not animate.

## Verification

Focused browser tests in `tests/e2e/whatsapp.spec.js` use a controlled clock for intro timing, verify actual CSS opacity/transition properties, unchanged icon bounds, desktop hover and keyboard focus, touch sizing, reduced motion and desktop/mobile footer clearance. The contact click is intercepted locally with a synthetic number; tests never contact WhatsApp or send messages. Unit/integration tests verify configuration validation, encoded Unicode greetings and omission when configuration is missing.
