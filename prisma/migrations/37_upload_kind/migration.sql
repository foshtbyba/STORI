-- Тип залива для разделения журналов (сторис/фото vs видео).
ALTER TABLE "UploadJob" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'static';
