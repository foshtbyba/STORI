-- Кампания FB у объявления — для группировки таблицы «Кампании» по кампаниям.
ALTER TABLE "FbAd" ADD COLUMN "campaignId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "FbAd" ADD COLUMN "campaignName" TEXT NOT NULL DEFAULT '';
