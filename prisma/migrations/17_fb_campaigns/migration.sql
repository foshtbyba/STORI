-- Догоняющая миграция: схема ушла вперёд, а SQL под неё не завели, поэтому на
-- чистом Postgres приложение поднималось с базой без этих таблиц и колонок.
--
-- Кампании Facebook кешируются в базе: экран кампаний открывается сразу, а не
-- ждёт обхода всех кабинетов через API.
-- Токен получает статус, прокси и куки: кабинеты открываются через прокси
-- владельца, а протухший токен помечается, а не удаляется.
-- DropIndex
DROP INDEX "AdToken_buyerId_idx";

-- AlterTable
ALTER TABLE "AdAccount" ADD COLUMN     "accountStatus" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "AdToken" ADD COLUMN     "cookiesJson" TEXT,
ADD COLUMN     "proxyUrl" TEXT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'ACTIVE',
ALTER COLUMN "token" SET DEFAULT '',
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "BrocardConfig" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "OverheadDay" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Tracker" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateTable
CREATE TABLE "FbCampaign" (
    "id" TEXT NOT NULL,
    "adAccountId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "dailyBudget" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FbCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FbCampaign_campaignId_key" ON "FbCampaign"("campaignId");

-- AddForeignKey
ALTER TABLE "FbCampaign" ADD CONSTRAINT "FbCampaign_adAccountId_fkey" FOREIGN KEY ("adAccountId") REFERENCES "AdAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

