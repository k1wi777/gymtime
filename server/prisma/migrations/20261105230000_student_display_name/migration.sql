-- Short name for the reader LCD. NULL for the existing students: the server
-- generates it from "nombre" when it is read (no lossy backfill in SQL).
ALTER TABLE "students" ADD COLUMN "display_name" TEXT;
