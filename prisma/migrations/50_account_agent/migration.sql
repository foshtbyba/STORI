-- Агент агентского кабинета: у разных агентов свой процент. Привязываем агента
-- к кабинету, чтобы процент брался автоматически (авторасход синка + дефолт в
-- «Доп. расходах»).
ALTER TABLE "AdAccount" ADD COLUMN IF NOT EXISTS "agentId" TEXT;
ALTER TABLE "AdAccount" ADD CONSTRAINT "AdAccount_agentId_fkey"
  FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
