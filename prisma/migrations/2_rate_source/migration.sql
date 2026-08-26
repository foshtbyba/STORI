-- AlterTable
ALTER TABLE "Period" ADD COLUMN     "rateSource" TEXT NOT NULL DEFAULT 'AUTO',
ADD COLUMN     "rateUpdatedAt" TIMESTAMP(3);
