-- Ключ владельца к языковой модели для чата внутри ORION (ADR-0017, вариант C).
CREATE TABLE "assistant_keys" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'anthropic',
    "model" TEXT NOT NULL,
    "keyEnc" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assistant_keys_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "assistant_keys_userId_key" ON "assistant_keys"("userId");

ALTER TABLE "assistant_keys" ADD CONSTRAINT "assistant_keys_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Строка видна только самому пользователю (секрет не должен быть виден даже участникам общих пространств).
ALTER TABLE "assistant_keys" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assistant_keys" FORCE ROW LEVEL SECURITY;
CREATE POLICY assistant_keys_owner ON "assistant_keys"
  USING ("userId" = current_setting('app.current_user_id', true))
  WITH CHECK ("userId" = current_setting('app.current_user_id', true));
