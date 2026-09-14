-- Исключаемые регионы (области/штаты) в шаблоне гео: JSON [{key,name,cc}].
ALTER TABLE "UploadTemplate" ADD COLUMN "excludedRegions" TEXT NOT NULL DEFAULT '';
