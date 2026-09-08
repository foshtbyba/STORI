-- Куда слать смену бюджета: адсет или кампания (CBO). Бюджет берём с того
-- уровня, где он реально задан.
ALTER TABLE "FbAd" ADD COLUMN "budgetTargetId" TEXT NOT NULL DEFAULT '';
