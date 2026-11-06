-- H9: academic periods, days without service and the link from schedules.
-- Additive: existing recurring schedules keep period_id NULL and behave as before.

CREATE TABLE "periods" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "nombre" TEXT NOT NULL,
  "inicio" DATE NOT NULL,
  "fin" DATE NOT NULL,
  "activo" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "periods_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "periods_inicio_before_fin" CHECK ("inicio" <= "fin")
);

-- At most one active period (not expressible in Prisma).
CREATE UNIQUE INDEX "periods_one_active" ON "periods" ((true)) WHERE "activo";

CREATE TABLE "service_exceptions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "period_id" UUID NOT NULL,
  "desde" DATE NOT NULL,
  "hasta" DATE NOT NULL,
  "motivo" TEXT NOT NULL,
  CONSTRAINT "service_exceptions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "service_exceptions_desde_before_hasta" CHECK ("desde" <= "hasta"),
  CONSTRAINT "service_exceptions_period_id_fkey" FOREIGN KEY ("period_id")
    REFERENCES "periods" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "service_exceptions_period_id_idx" ON "service_exceptions" ("period_id");

ALTER TABLE "schedules" ADD COLUMN "period_id" UUID;
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_period_id_fkey" FOREIGN KEY ("period_id")
  REFERENCES "periods" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "schedule_instances" ADD COLUMN "generated_at" TIMESTAMPTZ(6);
