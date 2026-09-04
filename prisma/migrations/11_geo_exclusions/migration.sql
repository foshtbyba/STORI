-- Исключения переезжают на уровень гео: у одного оффера в разных странах
-- запрещены разные регионы и города. Списки на самом оффере остаются общими
-- для всех гео, чтобы не дублировать их в каждой строке.
ALTER TABLE "OfferGeo" ADD COLUMN "bansJson" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "OfferGeo" ADD COLUMN "citiesJson" TEXT NOT NULL DEFAULT '[]';
