-- Касса: стартовые балансы овнеров, их личные выводы и снимки реальных денег.
CREATE TABLE "OwnerCapital" (
    "id" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "openingCents" INTEGER NOT NULL DEFAULT 0,
    "anchorDate" TIMESTAMP(3) NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OwnerCapital_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OwnerCapital_buyerId_key" ON "OwnerCapital"("buyerId");
ALTER TABLE "OwnerCapital" ADD CONSTRAINT "OwnerCapital_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "Buyer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "OwnerWithdrawal" (
    "id" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT NOT NULL DEFAULT '',
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OwnerWithdrawal_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "OwnerWithdrawal_buyerId_idx" ON "OwnerWithdrawal"("buyerId");
ALTER TABLE "OwnerWithdrawal" ADD CONSTRAINT "OwnerWithdrawal_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "Buyer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "TreasurySnapshot" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "partnersCents" INTEGER NOT NULL DEFAULT 0,
    "brocardCents" INTEGER NOT NULL DEFAULT 0,
    "cardCents" INTEGER NOT NULL DEFAULT 0,
    "agentsCents" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TreasurySnapshot_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TreasurySnapshot_date_key" ON "TreasurySnapshot"("date");
