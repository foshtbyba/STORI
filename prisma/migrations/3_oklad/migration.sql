-- Оклад теперь задаётся в рублях и работает нижней границей выплаты,
-- а не долларовой добавкой сверху.
ALTER TABLE "SalaryRule" DROP COLUMN "fixedCents";
ALTER TABLE "SalaryRule" ADD COLUMN     "fixedRub" INTEGER NOT NULL DEFAULT 10000;
