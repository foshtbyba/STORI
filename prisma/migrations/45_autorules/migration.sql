-- Автоправила: шаблоны, назначения, состояние, журнал.

CREATE TABLE "AutoRule" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "level" TEXT NOT NULL DEFAULT 'ad',
  "windowDays" INTEGER NOT NULL DEFAULT 1,
  "params" TEXT NOT NULL DEFAULT '{}',
  "buyerId" TEXT NOT NULL DEFAULT '',
  "scope" TEXT NOT NULL DEFAULT 'owner',
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AutoRule_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AutoRule_enabled_idx" ON "AutoRule"("enabled");

CREATE TABLE "AutoRuleAssignment" (
  "id" TEXT NOT NULL,
  "ruleId" TEXT NOT NULL,
  "adAccountId" TEXT NOT NULL,
  "scopeFbId" TEXT NOT NULL DEFAULT '',
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AutoRuleAssignment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AutoRuleAssignment_ruleId_adAccountId_scopeFbId_key" ON "AutoRuleAssignment"("ruleId", "adAccountId", "scopeFbId");
CREATE INDEX "AutoRuleAssignment_adAccountId_idx" ON "AutoRuleAssignment"("adAccountId");
ALTER TABLE "AutoRuleAssignment" ADD CONSTRAINT "AutoRuleAssignment_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "AutoRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AutoRuleState" (
  "id" TEXT NOT NULL,
  "ruleId" TEXT NOT NULL,
  "targetFbId" TEXT NOT NULL,
  "targetType" TEXT NOT NULL DEFAULT 'ad',
  "pausedByRule" BOOLEAN NOT NULL DEFAULT false,
  "pausedBySchedule" BOOLEAN NOT NULL DEFAULT false,
  "lastScaleAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AutoRuleState_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AutoRuleState_ruleId_targetFbId_key" ON "AutoRuleState"("ruleId", "targetFbId");

CREATE TABLE "AutoRuleLog" (
  "id" TEXT NOT NULL,
  "ruleId" TEXT NOT NULL DEFAULT '',
  "ruleName" TEXT NOT NULL DEFAULT '',
  "adAccountId" TEXT NOT NULL DEFAULT '',
  "accountName" TEXT NOT NULL DEFAULT '',
  "targetType" TEXT NOT NULL DEFAULT '',
  "targetFbId" TEXT NOT NULL DEFAULT '',
  "targetName" TEXT NOT NULL DEFAULT '',
  "action" TEXT NOT NULL DEFAULT '',
  "reason" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AutoRuleLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AutoRuleLog_createdAt_idx" ON "AutoRuleLog"("createdAt");
