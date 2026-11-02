-- Aditive: how many open sessions were marked no_registrada when the alarm
-- event was closed (manual off or timeout). Existing rows keep zero.
ALTER TABLE "alarm_events"
ADD COLUMN "sesiones_cerradas" INTEGER NOT NULL DEFAULT 0;
