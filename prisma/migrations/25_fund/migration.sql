-- Фонд баеров: касса чистого заработка команды (accrual по неделям + выводы).
CREATE TABLE "FundEntry" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "periodId" TEXT,
    "periodKey" TEXT NOT NULL DEFAULT '',
    "amountCents" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FundEntry_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "FundEntry_kind_periodId_key" ON "FundEntry"("kind", "periodId");
CREATE INDEX "FundEntry_createdAt_idx" ON "FundEntry"("createdAt");
