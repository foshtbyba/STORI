-- Статистика по объявлениям Facebook (раздел «Кампании» как в FBTOOL).
-- FbAd получает мету адсета/таргета/превью для таблицы; FbAdDay — дневные
-- метрики (расход, показы, клики, лиды) + доход из КТ по ad_id для профита.

-- AlterTable
ALTER TABLE "FbAd" ADD COLUMN     "adsetId" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "adsetName" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "dailyBudget" INTEGER,
ADD COLUMN     "targeting" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "thumbnailUrl" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "FbAdDay" (
    "id" TEXT NOT NULL,
    "adId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "spendCents" INTEGER NOT NULL DEFAULT 0,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "leads" INTEGER NOT NULL DEFAULT 0,
    "revenueCents" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FbAdDay_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FbAdDay_date_idx" ON "FbAdDay"("date");

-- CreateIndex
CREATE UNIQUE INDEX "FbAdDay_adId_date_key" ON "FbAdDay"("adId", "date");

-- AddForeignKey
ALTER TABLE "FbAdDay" ADD CONSTRAINT "FbAdDay_adId_fkey" FOREIGN KEY ("adId") REFERENCES "FbAd"("id") ON DELETE CASCADE ON UPDATE CASCADE;
