-- Идемпотентный ключ событий + метка расхода кабинета (детект скачка).

ALTER TABLE "Activity" ADD COLUMN "refKey" TEXT;
CREATE INDEX "Activity_refKey_idx" ON "Activity"("refKey");

ALTER TABLE "AdAccount" ADD COLUMN "spendMarkCents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AdAccount" ADD COLUMN "spendMarkAt" TIMESTAMP(3);
