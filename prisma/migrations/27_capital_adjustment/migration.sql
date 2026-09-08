-- Прочие движения кассы: внешние заливы, доход/расход мимо дашборда.
CREATE TABLE "CapitalAdjustment" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "buyerId" TEXT,
    "amountCents" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT NOT NULL DEFAULT '',
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CapitalAdjustment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CapitalAdjustment_scope_buyerId_idx" ON "CapitalAdjustment"("scope", "buyerId");
