-- Привязка расхода из Facebook к кампаниям Keitaro.
--
-- FbAd — объявление с распарсенным из ссылки токеном кампании КТ (qynyTnDK).
-- KtCostDay — суммарный расход по токену кампании КТ за день (для ROI и заливки
--   расхода обратно в Keitaro).
-- KtCampaignDay — доход и конверсии из КТ по кампании и дню, чтобы сводить с
--   расходом и считать ROI по каждому потоку.

-- CreateTable
CREATE TABLE "FbAd" (
    "id" TEXT NOT NULL,
    "adAccountId" TEXT NOT NULL,
    "adId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "linkUrl" TEXT NOT NULL DEFAULT '',
    "ktToken" TEXT NOT NULL DEFAULT '',
    "lastSpendAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FbAd_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KtCostDay" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "ktToken" TEXT NOT NULL,
    "ktCampaignId" TEXT NOT NULL DEFAULT '',
    "ktCampaignName" TEXT NOT NULL DEFAULT '',
    "spendCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "pushedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KtCostDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KtCampaignDay" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "campaignId" TEXT NOT NULL,
    "campaignName" TEXT NOT NULL DEFAULT '',
    "groupId" TEXT NOT NULL DEFAULT '',
    "revenueCents" INTEGER NOT NULL DEFAULT 0,
    "conversions" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KtCampaignDay_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FbAd_adId_key" ON "FbAd"("adId");

-- CreateIndex
CREATE INDEX "FbAd_ktToken_idx" ON "FbAd"("ktToken");

-- CreateIndex
CREATE INDEX "FbAd_adAccountId_idx" ON "FbAd"("adAccountId");

-- CreateIndex
CREATE INDEX "KtCostDay_date_idx" ON "KtCostDay"("date");

-- CreateIndex
CREATE UNIQUE INDEX "KtCostDay_ktToken_date_key" ON "KtCostDay"("ktToken", "date");

-- CreateIndex
CREATE INDEX "KtCampaignDay_date_idx" ON "KtCampaignDay"("date");

-- CreateIndex
CREATE UNIQUE INDEX "KtCampaignDay_campaignId_date_key" ON "KtCampaignDay"("campaignId", "date");

-- AddForeignKey
ALTER TABLE "FbAd" ADD CONSTRAINT "FbAd_adAccountId_fkey" FOREIGN KEY ("adAccountId") REFERENCES "AdAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
