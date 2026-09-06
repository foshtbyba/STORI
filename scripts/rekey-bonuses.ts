/**
 * Перенос разовых бонусов с месяца на неделю:
 *   npx tsx scripts/rekey-bonuses.ts          — показать, что изменится
 *   npx tsx scripts/rekey-bonuses.ts --apply  — применить
 *
 * Расчётный период стал неделей, а бонусы, начисленные до этого, лежат под
 * месячным ключом вида 2026-08. Ни один недельный лист их не подхватывает:
 * деньги начислены, но нигде не показываются и никому не выплачиваются.
 * Скрипт перевешивает такой бонус на неделю, в которую он был начислен, — то
 * есть на ту неделю, где его и увидели бы, начисляй его сегодня.
 *
 * Закрытые недели не трогаем: по ним уже посчитали и выплатили, и появление
 * там новой суммы задним числом разошлось бы с тем, что человек получил на руки.
 */
import { PrismaClient } from '@prisma/client';
import { isWeekKey, weekKey, weekLabel } from '../src/lib/period';

const db = new PrismaClient();

async function main() {
  const apply = process.argv.includes('--apply');
  const bonuses = await db.bonus.findMany({
    include: { buyer: { select: { handle: true } } },
    orderBy: { createdAt: 'asc' },
  });

  const closed = new Set(
    (await db.period.findMany({ where: { status: 'CLOSED' }, select: { key: true } })).map(
      (p) => p.key,
    ),
  );

  const stray = bonuses.filter((b) => !isWeekKey(b.periodKey));
  if (stray.length === 0) {
    console.log('Бонусов с месячным ключом нет — всё уже по неделям.');
    return;
  }

  let moved = 0;
  let skipped = 0;
  for (const bonus of stray) {
    const target = weekKey(bonus.createdAt);
    const amount = (bonus.amountCents / 100).toFixed(2);
    if (closed.has(target)) {
      skipped += 1;
      console.log(
        `× ${bonus.buyer.handle} $${amount} · ${bonus.periodKey} → ${weekLabel(target)} — неделя закрыта, оставляю`,
      );
      continue;
    }
    moved += 1;
    console.log(`→ ${bonus.buyer.handle} $${amount} · ${bonus.periodKey} → ${weekLabel(target)}`);
    if (apply) {
      await db.bonus.update({ where: { id: bonus.id }, data: { periodKey: target } });
    }
  }

  console.log(
    apply
      ? `Перенесено: ${moved}, оставлено в закрытых неделях: ${skipped}.`
      : `Будет перенесено: ${moved}, останется в закрытых неделях: ${skipped}. Запусти с --apply.`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
