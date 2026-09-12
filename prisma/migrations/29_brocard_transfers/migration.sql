-- Лог переводов Brocard (пополнение счёта баера с общего счёта).

CREATE TABLE "BrocardTransfer" (
    "id" TEXT NOT NULL,
    "fromAcc" TEXT NOT NULL,
    "toAcc" TEXT NOT NULL,
    "buyerId" TEXT,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "comment" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'ok',
    "error" TEXT NOT NULL DEFAULT '',
    "respJson" TEXT NOT NULL DEFAULT '',
    "actorId" TEXT,
    "actorName" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BrocardTransfer_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BrocardTransfer_buyerId_createdAt_idx" ON "BrocardTransfer"("buyerId", "createdAt");
CREATE INDEX "BrocardTransfer_createdAt_idx" ON "BrocardTransfer"("createdAt");

ALTER TABLE "BrocardTransfer" ADD CONSTRAINT "BrocardTransfer_buyerId_fkey"
    FOREIGN KEY ("buyerId") REFERENCES "Buyer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
