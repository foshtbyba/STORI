/**
 * Пересчёт комиссии по обратному проценту:
 *   npx tsx scripts/recalc-commission.ts          — показать, что изменится
 *   npx tsx scripts/recalc-commission.ts --apply  — применить
 *
 * Комиссия платёжки сидит внутри перевода, а не сверху: раньше расход с
 * комиссией считался умножением, теперь делением. Трогаем только те строки,
 * что были посчитаны старой формулой автоматически — если «расход с
 * комиссией» вбивали руками, значение не совпадёт со старой формулой и
 * останется как есть.
 */
import { PrismaClient } from '@prisma/client';
import { grossUp, grossUpLegacy } from '../src/lib/money';
import { periodKey } from '../src/lib/period';

const db = new PrismaClient();

async function main() {
  const apply = process.argv.includes('--apply');
  const days = await db.dayReport.findMany({
    select: { id: true, date: true, spendNetCents: true, spendGrossCents: true, commissionBps: true },
    orderBy: { date: 'asc' },
  });

  // Закрытый период не трогаем: по нему уже посчитали и выплатили.
  const closed = new Set(
    (await db.period.findMany({ where: { status: 'CLOSED' }, select: { key: true } })).map((p) => p.key),
  );

  let touched = 0;
  let skipped = 0;
  let frozen = 0;
  let delta = 0;

  for (const d of days) {
    if (closed.has(periodKey(d.date))) {
      frozen++;
      continue;
    }
    const wasAuto = d.spendGrossCents === grossUpLegacy(d.spendNetCents, d.commissionBps);
    if (!wasAuto) {
      skipped++;
      continue;
    }
    const next = grossUp(d.spendNetCents, d.commissionBps);
    if (next === d.spendGrossCents) continue;
    delta += next - d.spendGrossCents;
    touched++;
    if (apply) {
      await db.dayReport.update({ where: { id: d.id }, data: { spendGrossCents: next } });
    }
  }

  console.log(
    `${apply ? 'Пересчитано' : 'Будет пересчитано'}: ${touched} из ${days.length}` +
      ` · вручную заданных не тронуто: ${skipped}` +
      (frozen ? ` · в закрытых периодах пропущено: ${frozen}` : '') +
      ` · расход вырастет на $${(delta / 100).toFixed(0)}`,
  );
  if (!apply && touched) console.log('Применить: npx tsx scripts/recalc-commission.ts --apply');
  await db.$disconnect();
}

main();
