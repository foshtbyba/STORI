-- Один оффер — много гео. Данные для конструктора переезжают из полей оффера
-- в отдельные строки: у каждого гео свой ID в кабинете, свой лендинг, своя цена.
CREATE TABLE "OfferGeo" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "langCode" TEXT NOT NULL,
    "uiLang" TEXT NOT NULL DEFAULT '',
    "partnerOfferId" TEXT NOT NULL DEFAULT '',
    "landingUrl" TEXT NOT NULL DEFAULT '',
    "streamCode" TEXT NOT NULL DEFAULT '',
    "price" TEXT NOT NULL DEFAULT '',
    "sort" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "OfferGeo_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "OfferGeo_offerId_idx" ON "OfferGeo"("offerId");
ALTER TABLE "OfferGeo" ADD CONSTRAINT "OfferGeo_offerId_fkey"
  FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Превью и фото отзывов храним в базе: отдельного хранилища нет, а диск
-- контейнера пропадает при пересборке.
CREATE TABLE "OfferFile" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'PREVIEW',
    "name" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OfferFile_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "OfferFile_offerId_kind_idx" ON "OfferFile"("offerId", "kind");
ALTER TABLE "OfferFile" ADD CONSTRAINT "OfferFile_offerId_fkey"
  FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Переносим то, что уже заведено одним гео.
INSERT INTO "OfferGeo" ("id", "offerId", "langCode", "uiLang", "partnerOfferId", "landingUrl", "streamCode", "price", "sort")
SELECT "id" || '-geo', "id", "langCode", "uiLang", "offerId", "landingUrl", "streamCode", "price", 0
FROM "Offer" WHERE "langCode" <> '';

ALTER TABLE "Offer" DROP COLUMN "offerId";
ALTER TABLE "Offer" DROP COLUMN "landingUrl";
ALTER TABLE "Offer" DROP COLUMN "streamCode";
ALTER TABLE "Offer" DROP COLUMN "langCode";
ALTER TABLE "Offer" DROP COLUMN "price";
ALTER TABLE "Offer" DROP COLUMN "imagePath";
ALTER TABLE "Offer" DROP COLUMN "uiLang";

-- Back-fix у команды один на все офферы: ставим его по умолчанию и проставляем
-- тем, у кого поле пустое.
ALTER TABLE "Offer" ALTER COLUMN "backfix" SET DEFAULT 'https://nutrivition.top/VXsVxCX?sun={sub_id_30}';
UPDATE "Offer" SET "backfix" = 'https://nutrivition.top/VXsVxCX?sun={sub_id_30}' WHERE "backfix" = '';
