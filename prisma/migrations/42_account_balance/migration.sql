-- Баланс/лимит рекламного кабинета (для «остатка открута»).

ALTER TABLE "AdAccount" ADD COLUMN "spendCapCents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AdAccount" ADD COLUMN "amountSpentCents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AdAccount" ADD COLUMN "balanceCents" INTEGER NOT NULL DEFAULT 0;
