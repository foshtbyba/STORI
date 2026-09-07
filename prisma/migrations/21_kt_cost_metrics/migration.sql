-- Клики и показы из Facebook в разрезе кампании КТ и дня — для CTR/CPC на
-- экране статистики. Приходят тем же запросом insights, что и расход.
ALTER TABLE "KtCostDay" ADD COLUMN "clicks" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "KtCostDay" ADD COLUMN "impressions" INTEGER NOT NULL DEFAULT 0;
