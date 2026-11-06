-- Accounts and revocable sessions of the web panel (H7). Additive: no existing
-- table is touched.
CREATE TYPE "panel_role" AS ENUM ('asistente', 'admin');

CREATE TABLE "panel_users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "panel_role" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "must_change_password" BOOLEAN NOT NULL DEFAULT true,
    "failed_attempts" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ,
    "last_login_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "panel_users_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "auth_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_activity_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "revoked_at" TIMESTAMPTZ,

    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "panel_users_username_key" ON "panel_users"("username");
CREATE UNIQUE INDEX "auth_sessions_token_hash_key" ON "auth_sessions"("token_hash");
CREATE INDEX "auth_sessions_user_id_idx" ON "auth_sessions"("user_id");

ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "panel_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
