-- Отпуск и отгул баер ставит себе сам, но они ждут подтверждения админа.
ALTER TABLE "Attendance" ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'APPROVED';
