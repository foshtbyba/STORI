-- Замороженный агентский расход удалённого кабинета: при удалении токена
-- снимаем слепок открута его агентских кабинетов по дням, чтобы «Агентка» не
-- просела после полного сноса аккаунта. Касса считает живой FbAdDay + это.
CREATE TABLE "AgencyFrozenDay" (
  "id" TEXT NOT NULL,
  "buyerId" TEXT NOT NULL,
  "externalId" TEXT NOT NULL,
  "date" TIMESTAMP(3) NOT NULL,
  "netCents" INTEGER NOT NULL,
  "grossCents" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AgencyFrozenDay_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AgencyFrozenDay_externalId_date_key" ON "AgencyFrozenDay"("externalId", "date");
CREATE INDEX "AgencyFrozenDay_buyerId_date_idx" ON "AgencyFrozenDay"("buyerId", "date");
CREATE INDEX "AgencyFrozenDay_date_idx" ON "AgencyFrozenDay"("date");
