-- Заявки «хочу в команду» с публичного лендинга (оставленный Telegram).

CREATE TABLE "TeamLead" (
    "id" TEXT NOT NULL,
    "telegram" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "handled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TeamLead_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TeamLead_createdAt_idx" ON "TeamLead"("createdAt");
