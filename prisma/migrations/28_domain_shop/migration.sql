-- Магазин доменов: склад доменов, цены по зонам, привязка к баеру.

ALTER TABLE "Buyer" ADD COLUMN "ktDomainGroupId" TEXT NOT NULL DEFAULT '';

CREATE TABLE "Domain" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "zone" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'available',
    "buyerId" TEXT,
    "soldAt" TIMESTAMP(3),
    "priceCents" INTEGER,
    "consumableId" TEXT,
    "ktId" TEXT NOT NULL DEFAULT '',
    "ktMoved" BOOLEAN NOT NULL DEFAULT false,
    "ktError" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Domain_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Domain_name_key" ON "Domain"("name");
CREATE INDEX "Domain_status_zone_idx" ON "Domain"("status", "zone");
CREATE INDEX "Domain_buyerId_idx" ON "Domain"("buyerId");

ALTER TABLE "Domain" ADD CONSTRAINT "Domain_buyerId_fkey"
    FOREIGN KEY ("buyerId") REFERENCES "Buyer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "DomainZonePrice" (
    "zone" TEXT NOT NULL,
    "priceCents" INTEGER NOT NULL,
    CONSTRAINT "DomainZonePrice_pkey" PRIMARY KEY ("zone")
);
