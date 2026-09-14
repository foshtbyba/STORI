-- Плейсменты в шаблоне автозалива: CSV ключей, пусто — авто (Advantage+).

ALTER TABLE "UploadTemplate" ADD COLUMN "placements" TEXT NOT NULL DEFAULT '';
