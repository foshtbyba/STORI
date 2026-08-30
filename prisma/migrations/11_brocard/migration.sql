-- Brocard — источник реального расхода: фактические списания с карт.
CREATE TABLE "BrocardConfig" (
    "id" TEXT NOT NULL,
    "apiKey" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncAt" TIMESTAMP(3),
    "lastError" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BrocardConfig_pkey" PRIMARY KEY ("id")
);

-- Расход делится по командам Brocard: команда — это баер.
CREATE TABLE "BrocardTeam" (
    "id" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "buyerId" TEXT,
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BrocardTeam_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BrocardTeam_externalId_key" ON "BrocardTeam"("externalId");
ALTER TABLE "BrocardTeam" ADD CONSTRAINT "BrocardTeam_buyerId_fkey"
  FOREIGN KEY ("buyerId") REFERENCES "Buyer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
