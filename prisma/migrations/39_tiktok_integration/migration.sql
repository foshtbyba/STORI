-- Интеграция TikTok Ads: подключение (OAuth Marketing API), кабинеты, дневной расход.

CREATE TABLE "TiktokToken" (
    "id" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "kind" TEXT NOT NULL DEFAULT 'api',
    "accessToken" TEXT NOT NULL DEFAULT '',
    "appId" TEXT NOT NULL DEFAULT '',
    "cookiesJson" TEXT,
    "proxyUrl" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "lastSyncAt" TIMESTAMP(3),
    "lastError" TEXT NOT NULL DEFAULT '',
    "pausedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TiktokToken_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TiktokAccount" (
    "id" TEXT NOT NULL,
    "tokenId" TEXT NOT NULL,
    "advertiserId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "timezone" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'STATUS_ENABLE',
    "statusReason" TEXT NOT NULL DEFAULT '',
    "balanceCents" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastSpendAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TiktokAccount_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TiktokAccountDay" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "spendCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    CONSTRAINT "TiktokAccountDay_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TiktokAccount_tokenId_advertiserId_key" ON "TiktokAccount"("tokenId", "advertiserId");
CREATE UNIQUE INDEX "TiktokAccountDay_accountId_date_key" ON "TiktokAccountDay"("accountId", "date");
CREATE INDEX "TiktokAccountDay_date_idx" ON "TiktokAccountDay"("date");

ALTER TABLE "TiktokToken" ADD CONSTRAINT "TiktokToken_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "Buyer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TiktokAccount" ADD CONSTRAINT "TiktokAccount_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "TiktokToken"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TiktokAccountDay" ADD CONSTRAINT "TiktokAccountDay_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "TiktokAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
