-- Local accounts: email is optional (unique when present; several NULLs are
-- allowed). Unlock is a password or a 4-digit PIN, both stored as argon2 in
-- passwordHash. Avatar bytes live in StorageAdapter under `_avatars/<userId>`.

ALTER TABLE "users" ALTER COLUMN "email" DROP NOT NULL;

ALTER TABLE "users" ADD COLUMN "unlockKind" TEXT NOT NULL DEFAULT 'password';
ALTER TABLE "users" ADD COLUMN "hasAvatar" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN "avatarMime" TEXT;
