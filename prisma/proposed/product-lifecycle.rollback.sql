-- Rollback only on a disposable/test database after confirming this queue is empty.
DROP TABLE IF EXISTS "cloudinary_cleanup_jobs";
