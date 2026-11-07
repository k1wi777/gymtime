-- H12: origin of an entry or exit reconstructed from a reader's offline queue.
-- Alone in its file: PostgreSQL cannot use a new enum value in the same
-- transaction that adds it.
ALTER TYPE "attendance_source" ADD VALUE 'offline';
