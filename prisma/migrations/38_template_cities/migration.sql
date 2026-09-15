-- Исключаемые города (комуны/муниципалитеты) в шаблоне гео: имена через запятую/;.
-- Ключи FB (city key) резолвим при заливе по имени токеном кабинета.
ALTER TABLE "UploadTemplate" ADD COLUMN "excludedCities" TEXT NOT NULL DEFAULT '';
