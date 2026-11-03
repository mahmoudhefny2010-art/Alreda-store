# InstaPay checkout and review

Cash on delivery remains the default. InstaPay stays unavailable until the owner configures receiving details in the server environment:

```dotenv
INSTAPAY_ENABLED=false
INSTAPAY_PHONE=
INSTAPAY_URL=
INSTAPAY_QR_URL=
```

Set the receiving mobile number and at least one of the HTTPS transfer link or QR image path, then enable InstaPay and restart. QR images can use `/assets/...png` (also JPG/WebP) or the configured Cloudinary account. Never invent receiving details. Cloudinary authenticated uploads must work before enabling transfers.

Customers select InstaPay, see the exact order total and receiving details, upload a JPG/PNG/WebP screenshot up to 5 MB, then submit the order. Uploading does not submit an order or verify payment. The server decodes and normalizes images, strips metadata and stores them as authenticated Cloudinary assets. PostgreSQL stores the asset reference, owner, hash, expiry and review status, without image bytes or public image URLs.

Order creation atomically claims the unused customer-owned proof, saves the order/items and reserves inventory. The normal admin repository must retrieve the committed order before the customer sees “recorded, awaiting admin payment review.” Idempotency reconciles retries without creating replacement orders. Only authorized order administrators can access the screenshot through a private no-store proxy.

In Orders, open the screenshot, independently check that the transfer actually reached the receiving account, enter its unique transfer reference and tick the verification checkbox before approving. A screenshot alone is not proof of received funds. Approval marks payment paid and confirms the order atomically with the audit event and notification outbox entry. Rejection cancels the order and restores its inventory once. Repeated reviews cannot duplicate stock changes; the same transfer reference cannot approve another order.

Apply Prisma migrations before deploying this code. The additive `20261103060000_instapay_review` migration adds `payment_proofs` and permits the new payment method. Disposable PostgreSQL tests cover apply, rollback and reapply. The proposed rollback refuses to run once InstaPay data exists; recover forward in that case. Never run a destructive rollback against store data.

Unused proofs expire for order attachment after 24 hours. Assets are retained privately; automatic orphan-media deletion and automatic cancellation of pending orders are not implemented. Pending inventory stays reserved until approval, rejection or cancellation. This is manual bank-transfer verification, with no automatic InstaPay payment API. No real order/payment is needed for the synthetic tests.
