-- Статус кабинета из Facebook и метка агентского.
-- disableReason раскрывает, ЧЕМ выключен кабинет (бан за integrity, риск-платёж,
-- проверка) — не только «активен/нет». agency помечает основной кабинет среди
-- дублей одного act_ID под разными профилями.
ALTER TABLE "AdAccount" ADD COLUMN "disableReason" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AdAccount" ADD COLUMN "agency" BOOLEAN NOT NULL DEFAULT false;
