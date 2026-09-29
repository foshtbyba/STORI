-- Автоправила: переход на конструктор (модель FB/FBtool). Добавляем новые
-- колонки и ослабляем старые NOT NULL, чтобы вставки без них проходили. Старые
-- колонки (type/windowDays/params) оставляем — они больше не используются.

ALTER TABLE "AutoRule" ALTER COLUMN "type" SET DEFAULT '';
ALTER TABLE "AutoRule" ALTER COLUMN "level" SET DEFAULT 'adset';

ALTER TABLE "AutoRule" ADD COLUMN IF NOT EXISTS "statusFilter" TEXT NOT NULL DEFAULT 'active';
ALTER TABLE "AutoRule" ADD COLUMN IF NOT EXISTS "action" TEXT NOT NULL DEFAULT 'pause';
ALTER TABLE "AutoRule" ADD COLUMN IF NOT EXISTS "actionParams" TEXT NOT NULL DEFAULT '{}';
ALTER TABLE "AutoRule" ADD COLUMN IF NOT EXISTS "frequency" TEXT NOT NULL DEFAULT 'halfhour';
ALTER TABLE "AutoRule" ADD COLUMN IF NOT EXISTS "hourAt" INTEGER;
ALTER TABLE "AutoRule" ADD COLUMN IF NOT EXISTS "windowKind" TEXT NOT NULL DEFAULT 'today';
ALTER TABLE "AutoRule" ADD COLUMN IF NOT EXISTS "conditions" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "AutoRule" ADD COLUMN IF NOT EXISTS "conditionsEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "AutoRule" ADD COLUMN IF NOT EXISTS "groupName" TEXT NOT NULL DEFAULT '';
ALTER TABLE "AutoRule" ADD COLUMN IF NOT EXISTS "lastRunAt" TIMESTAMP(3);
