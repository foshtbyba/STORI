/**
 * Подравнивает уже накопленные суммы до целого доллара:
 * npx tsx scripts/round-cents.ts
 *
 * На проде то же самое делает миграция 6_whole_dollars. Скрипт нужен для
 * локальной базы, где схема стоит на sqlite и миграции не проигрываются.
 */
import { PrismaClient } from '@prisma/client';
const db = new PrismaClient();
async function main() {
  const days = await db.dayReport.findMany({ select: { id: true, spendGrossCents: true } });
  let n = 0;
  for (const d of days) {
    const w = Math.round(d.spendGrossCents / 100) * 100;
    if (w !== d.spendGrossCents) { await db.dayReport.update({ where: { id: d.id }, data: { spendGrossCents: w } }); n++; }
  }
  const bs = await db.bonus.findMany({ select: { id: true, amountCents: true } });
  let m = 0;
  for (const b of bs) {
    const w = Math.round(b.amountCents / 100) * 100;
    if (w !== b.amountCents) { await db.bonus.update({ where: { id: b.id }, data: { amountCents: w } }); m++; }
  }
  console.log('дней подравнено', n, '· бонусов', m);
  await db.$disconnect();
  
}
main();
