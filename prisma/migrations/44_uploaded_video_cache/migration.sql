-- Кэш загруженных в кабинет роликов (переиспользуем video_id по хэшу файла).
CREATE TABLE "UploadedVideo" (
  "id" TEXT NOT NULL,
  "accountExternalId" TEXT NOT NULL,
  "contentHash" TEXT NOT NULL,
  "fbVideoId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UploadedVideo_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "UploadedVideo_accountExternalId_contentHash_key" ON "UploadedVideo"("accountExternalId", "contentHash");
CREATE INDEX "UploadedVideo_accountExternalId_idx" ON "UploadedVideo"("accountExternalId");
