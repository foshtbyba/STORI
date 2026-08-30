-- Профиль баера: справочные поля, в расчётах не участвуют.
-- birthday — день рождения; position — позиция в команде (BUYER/LEAD), отдельно
-- от роли доступа.
ALTER TABLE "Buyer" ADD COLUMN "birthday" TIMESTAMP(3);
ALTER TABLE "Buyer" ADD COLUMN "position" TEXT;
