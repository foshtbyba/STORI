-- Шаблоны автозалива становятся личными: у каждого пользователя свои.

ALTER TABLE "UploadTemplate" ADD COLUMN "userId" TEXT NOT NULL DEFAULT '';

CREATE INDEX "UploadTemplate_userId_idx" ON "UploadTemplate"("userId");
