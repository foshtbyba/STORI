-- Дата увольнения баера: человек уходит из текущих списков/статистики,
-- но отработанные периоды остаются в истории (см. teamSummary).
ALTER TABLE "Buyer" ADD COLUMN IF NOT EXISTS "endedAt" TIMESTAMP(3);
