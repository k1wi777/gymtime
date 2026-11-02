-- The old NOT NULL DEFAULT 0 would make a zero override the configured default.
-- No real schedules exist yet, so existing rows go back to "use the default".
ALTER TABLE "schedules" ALTER COLUMN "margen_ingreso" DROP NOT NULL,
ALTER COLUMN "margen_ingreso" DROP DEFAULT;
UPDATE "schedules" SET "margen_ingreso" = NULL;

ALTER TABLE "schedules" ADD COLUMN "margen_cierre_ingreso" INTEGER;
