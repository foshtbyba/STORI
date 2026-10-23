-- Агенты агентских кабинетов: у каждого свой процент (раньше была фикс. 6%).
-- Процент снапшотится в DayReport.commissionBps, здесь храним сам справочник.
CREATE TABLE "Agent" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "commissionBps" INTEGER NOT NULL DEFAULT 600,
  "archived" BOOLEAN NOT NULL DEFAULT false,
  "sort" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Agent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Agent_name_key" ON "Agent"("name");

-- Привязка строки «Агентка» к агенту (ставка уже лежит в commissionBps строки).
ALTER TABLE "DayReport" ADD COLUMN IF NOT EXISTS "agentId" TEXT;
ALTER TABLE "DayReport" ADD CONSTRAINT "DayReport_agentId_fkey"
  FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
