-- Non-destructive catalog lifecycle support. Archived state lives in existing
-- catalog_details.presentation JSON; this durable queue retries Cloudinary
-- cleanup after a product's database transaction has committed.
CREATE TABLE "cloudinary_cleanup_jobs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "public_id" VARCHAR(240) NOT NULL,
  "asset_id" VARCHAR(240),
  "status" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "next_attempt_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_error_code" VARCHAR(64) NOT NULL DEFAULT '',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMPTZ(6),
  CONSTRAINT "cloudinary_cleanup_jobs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "cloudinary_cleanup_jobs_status_check" CHECK ("status" IN ('PENDING', 'COMPLETE'))
);
CREATE UNIQUE INDEX "cloudinary_cleanup_jobs_public_id_key" ON "cloudinary_cleanup_jobs"("public_id");
CREATE UNIQUE INDEX "cloudinary_cleanup_jobs_asset_id_key" ON "cloudinary_cleanup_jobs"("asset_id");
CREATE INDEX "cloudinary_cleanup_due_idx" ON "cloudinary_cleanup_jobs"("status", "next_attempt_at");

-- Rollback if no cleanup job data needs preserving:
-- DROP TABLE "cloudinary_cleanup_jobs";
