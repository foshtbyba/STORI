-- Антидребезг любого действия автоправила по цели (пауза/старт/бюджет).
ALTER TABLE "AutoRuleState" ADD COLUMN IF NOT EXISTS "lastActionAt" TIMESTAMP(3);
