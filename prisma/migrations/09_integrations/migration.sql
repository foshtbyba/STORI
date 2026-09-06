-- Интеграции: расход тянем из Facebook, доход — из Keitaro.

-- Токен Facebook привязан к баеру: кабинеты лежат в разных Business Manager,
-- и всё, что видно под токеном, принадлежит его владельцу.
CREATE TABLE "AdToken" (
    "id" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "token" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncAt" TIMESTAMP(3),
    "lastError" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AdToken_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AdToken_buyerId_idx" ON "AdToken"("buyerId");
ALTER TABLE "AdToken" ADD CONSTRAINT "AdToken_buyerId_fkey"
  FOREIGN KEY ("buyerId") REFERENCES "Buyer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Кабинет наследует владельца от своего токена, отдельной привязки не нужно.
CREATE TABLE "AdAccount" (
    "id" TEXT NOT NULL,
    "tokenId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastSpendAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AdAccount_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AdAccount_tokenId_externalId_key" ON "AdAccount"("tokenId", "externalId");
ALTER TABLE "AdAccount" ADD CONSTRAINT "AdAccount_tokenId_fkey"
  FOREIGN KEY ("tokenId") REFERENCES "AdToken"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Keitaro один на команду — строка тут ровно одна.
CREATE TABLE "Tracker" (
    "id" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "apiKey" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncAt" TIMESTAMP(3),
    "lastError" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Tracker_pkey" PRIMARY KEY ("id")
);

-- Доход делится по группам кампаний: группа — это баер.
CREATE TABLE "TrackerGroup" (
    "id" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "buyerId" TEXT,
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TrackerGroup_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TrackerGroup_externalId_key" ON "TrackerGroup"("externalId");
ALTER TABLE "TrackerGroup" ADD CONSTRAINT "TrackerGroup_buyerId_fkey"
  FOREIGN KEY ("buyerId") REFERENCES "Buyer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Следы синхронизации в отчёте дня. Отличают «никто не трогал» от «поправили
-- руками»: если текущее значение совпадает с записанным, строку можно
-- обновлять, если нет — правка ручная, и синхронизация её не переписывает.
ALTER TABLE "DayReport" ADD COLUMN "spendSyncedCents" INTEGER;
ALTER TABLE "DayReport" ADD COLUMN "revenueSyncedCents" INTEGER;
ALTER TABLE "DayReport" ADD COLUMN "syncedAt" TIMESTAMP(3);
