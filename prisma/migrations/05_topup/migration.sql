-- Контроль закидов на рекламные кабинеты: незакинутое переносится на следующий день.
ALTER TABLE "DayReport" ADD COLUMN     "toppedUpAt" TIMESTAMP(3);
