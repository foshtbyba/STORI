-- Лента событий (уведомления) + отметка «последний просмотр» у пользователя.

ALTER TABLE "User" ADD COLUMN "notifSeenAt" TIMESTAMP(3);

CREATE TABLE "Activity" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "actorUserId" TEXT,
    "actorName" TEXT NOT NULL DEFAULT '',
    "adminOnly" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Activity_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Activity_createdAt_idx" ON "Activity"("createdAt");
CREATE INDEX "Activity_actorUserId_idx" ON "Activity"("actorUserId");
