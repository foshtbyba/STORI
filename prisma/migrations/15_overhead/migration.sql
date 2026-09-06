-- Расходники на команду («общак» в Brocard).
-- Команда, помеченная overhead, тратит деньги не на баера, а на всю команду:
-- её расход не идёт никому в профит, а копится отдельной строкой по дням.
ALTER TABLE "BrocardTeam" ADD COLUMN "overhead" BOOLEAN NOT NULL DEFAULT false;

-- Команду с именем «Общак» помечаем сразу — с неё и идёт расход на расходники.
UPDATE "BrocardTeam" SET "overhead" = true WHERE lower(trim("name")) = 'общак';

CREATE TABLE "OverheadDay" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "spendCents" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OverheadDay_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OverheadDay_date_key" ON "OverheadDay"("date");
