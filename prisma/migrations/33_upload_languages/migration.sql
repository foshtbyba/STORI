-- Фиксированные доп. языки для видео-автозалива (личные, по пользователю).

CREATE TABLE "UploadLanguage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL DEFAULT '',
    "locale" TEXT NOT NULL,
    "videoUrl" TEXT NOT NULL DEFAULT '',
    "headline" TEXT NOT NULL DEFAULT '',
    "primaryText" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "link" TEXT NOT NULL DEFAULT '',
    "sort" INTEGER NOT NULL DEFAULT 0,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "UploadLanguage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "UploadLanguage_userId_idx" ON "UploadLanguage"("userId");
