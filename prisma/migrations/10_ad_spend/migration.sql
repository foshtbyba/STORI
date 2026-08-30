-- Дневной расход кабинета из Facebook — информативно, отдельно от отчётов дня.
-- Реальный расход команды приходит из Brocard; цифра из ФБ нужна для будущего
-- мониторинга и не участвует в зарплате.
CREATE TABLE "AdAccountDay" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "spendCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    CONSTRAINT "AdAccountDay_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AdAccountDay_accountId_date_key" ON "AdAccountDay"("accountId", "date");
CREATE INDEX "AdAccountDay_date_idx" ON "AdAccountDay"("date");
ALTER TABLE "AdAccountDay" ADD CONSTRAINT "AdAccountDay_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "AdAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
