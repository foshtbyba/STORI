-- Автозалив: шаблоны гео и журнал запусков.

CREATE TABLE "UploadTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "countries" TEXT NOT NULL DEFAULT '',
    "excluded" TEXT NOT NULL DEFAULT '',
    "ageMin" INTEGER NOT NULL DEFAULT 18,
    "ageMax" INTEGER NOT NULL DEFAULT 65,
    "genders" TEXT NOT NULL DEFAULT '',
    "dailyBudgetCents" INTEGER NOT NULL DEFAULT 2000,
    "event" TEXT NOT NULL DEFAULT 'LEAD',
    "cta" TEXT NOT NULL DEFAULT 'LEARN_MORE',
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "UploadTemplate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UploadJob" (
    "id" TEXT NOT NULL,
    "buyerId" TEXT,
    "accountId" TEXT NOT NULL,
    "accountName" TEXT NOT NULL DEFAULT '',
    "campaignName" TEXT NOT NULL DEFAULT '',
    "mode" TEXT NOT NULL DEFAULT 'paused',
    "status" TEXT NOT NULL DEFAULT 'running',
    "adsPlanned" INTEGER NOT NULL DEFAULT 0,
    "adsCreated" INTEGER NOT NULL DEFAULT 0,
    "campaignFbId" TEXT NOT NULL DEFAULT '',
    "log" TEXT NOT NULL DEFAULT '',
    "error" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "UploadJob_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "UploadJob_accountId_idx" ON "UploadJob"("accountId");
