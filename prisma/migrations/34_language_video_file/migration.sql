-- Видео фиксированного языка можно грузить файлом (байты у нас), не только ссылкой.

ALTER TABLE "UploadLanguage" ADD COLUMN "videoData" BYTEA;
ALTER TABLE "UploadLanguage" ADD COLUMN "videoMime" TEXT NOT NULL DEFAULT '';
ALTER TABLE "UploadLanguage" ADD COLUMN "videoName" TEXT NOT NULL DEFAULT '';
