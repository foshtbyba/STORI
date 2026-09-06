-- Данные оффера для конструктора лендов: то, что он спрашивает при сборке.
ALTER TABLE "Offer" ADD COLUMN "partnerKey" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Offer" ADD COLUMN "offerId"    TEXT NOT NULL DEFAULT '';
ALTER TABLE "Offer" ADD COLUMN "landingUrl" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Offer" ADD COLUMN "streamCode" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Offer" ADD COLUMN "langCode"   TEXT NOT NULL DEFAULT '';
ALTER TABLE "Offer" ADD COLUMN "price"      TEXT NOT NULL DEFAULT '';
ALTER TABLE "Offer" ADD COLUMN "imagePath"  TEXT NOT NULL DEFAULT '';
ALTER TABLE "Offer" ADD COLUMN "backfix"    TEXT NOT NULL DEFAULT '';
ALTER TABLE "Offer" ADD COLUMN "uiLang"     TEXT NOT NULL DEFAULT '';
