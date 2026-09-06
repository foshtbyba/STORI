-- Центы в отчётности не считаем, поэтому и хранить их в производных суммах
-- незачем: пока в базе лежали копейки, столбик не сходился — две строки по
-- $121,43 показывались как $121 и $121, а их сумма как $243. Подтягиваем
-- уже накопленные суммы к целому доллару.
UPDATE "DayReport" SET "spendGrossCents" = ROUND("spendGrossCents" / 100.0) * 100
  WHERE "spendGrossCents" % 100 <> 0;
UPDATE "Bonus" SET "amountCents" = ROUND("amountCents" / 100.0) * 100
  WHERE "amountCents" % 100 <> 0;
