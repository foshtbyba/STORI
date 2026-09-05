/**
 * Что на самом деле показывает гора:
 *   docker compose exec app npx tsx scripts/peak-debug.ts
 *
 * Гора масштабируется не по профиту, а по нему же за вычетом расходников — и
 * когда цифра на экране расходится с той, что в голове, спорить об этом на
 * словах бесполезно. Скрипт печатает ровно те числа, из которых страница
 * считает вершину: у кого сколько, какая лесенка, где встала макушка и почему.
 */
import { PrismaClient } from '@prisma/client';
import { weekKey, weekBounds } from '../src/lib/period';
import { parseTiers } from '../src/lib/salary';
import { nextPeakMilestone } from '../src/lib/money';

const prisma = new PrismaClient();
const usd = (c: number) => '$' + (c / 100).toLocaleString('ru-RU');

async function main() {
  const key = weekKey(new Date());
  const { from, to } = weekBounds(key);
  console.log(`Неделя ${key}: ${from.toISOString().slice(0, 10)} … ${to.toISOString().slice(0, 10)}\n`);

  const buyers = await prisma.buyer.findMany({
    where: { archived: false },
    include: { salaryRule: true },
    orderBy: { handle: 'asc' },
  });
  const days = await prisma.dayReport.findMany({ where: { date: { gte: from, lt: to } } });
  const spent = await prisma.consumableEntry.findMany({ where: { date: { gte: from, lt: to } } });

  const rows = buyers.map((b) => {
    const mine = days.filter((d) => d.buyerId === b.id);
    const revenue = mine.reduce((a, d) => a + d.revenueCents, 0);
    const gross = mine.reduce((a, d) => a + d.spendGrossCents, 0);
    const profit = revenue - gross;
    const cons = spent.filter((c) => c.buyerId === b.id).reduce((a, c) => a + c.totalCents, 0);
    const net = b.consumablesAffectSalary ? profit - cons : profit;
    return { b, revenue, gross, profit, cons, net };
  });

  console.log('баер      овнер  доход      расход     профит     расходники  НА ГОРЕ');
  for (const r of rows) {
    console.log(
      r.b.handle.padEnd(10) +
        (r.b.owner ? 'да     ' : 'нет    ') +
        usd(r.revenue).padEnd(11) +
        usd(r.gross).padEnd(11) +
        usd(r.profit).padEnd(11) +
        usd(r.cons).padEnd(12) +
        usd(r.net),
    );
  }

  // На горе стоят и баеры, и овнеры — высоту задают все, кто на ней есть.
  const climbing = rows.filter((r) => r.net > 0);
  const best = climbing.reduce((m, r) => Math.max(m, r.net), 0);
  const tiers = parseTiers(rows.find((r) => !r.b.owner)?.b.salaryRule?.tiersJson);
  const top = tiers[tiers.length - 1]?.fromCents ?? 1_000_000;
  const beyond = best >= top;
  const summit = beyond
    ? nextPeakMilestone(best)
    : (tiers.find((t) => t.fromCents > best)?.fromCents ?? top);

  console.log('\nлесенка:      ' + tiers.map((t) => `${usd(t.fromCents)}→${t.ratePct}%`).join('  '));
  console.log('верх лесенки: ' + usd(top));
  console.log('на горе:      ' + (climbing.map((r) => r.b.handle).join(', ') || '— никого'));
  console.log('лидер горы:   ' + usd(best) + (beyond ? '  (лесенка пройдена, дальше вехи)' : ''));
  console.log('ВЕРШИНА:      ' + usd(summit));
  if (!beyond) {
    console.log(`\nЧтобы вершина стала ${usd(tiers.find((t) => t.fromCents > summit)?.fromCents ?? summit)},`);
    console.log(`лидеру нужно перешагнуть ${usd(summit)} по колонке «НА ГОРЕ» — не по профиту.`);
  }
}

main().finally(() => prisma.$disconnect());
