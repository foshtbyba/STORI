-- Живой этап залива (для статуса в «Журнале заливов», пока идёт).
ALTER TABLE "UploadJob" ADD COLUMN "stage" TEXT NOT NULL DEFAULT '';
