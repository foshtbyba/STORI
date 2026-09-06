/**
 * Заводит справочники на чистой базе: лесенку ставок, платёжки и типы
 * расходников. Никаких денег и дней — только то, из чего потом выбирают.
 *
 *   npx tsx scripts/init-catalog.ts
 *
 * Запускать можно сколько угодно раз: существующие записи не трогает и не
 * дублирует, так что это безопасно и после обновления.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const TIERS = [
  { fromCents: 80_000, ratePct: 30 },
  { fromCents: 160_000, ratePct: 30 },
  { fromCents: 240_000, ratePct: 30 },
  { fromCents: 500_000, ratePct: 40 },
  { fromCents: 1_000_000, ratePct: 50 },
];

const METHODS = [
  { name: 'Wise', commissionBps: 450 },
  { name: 'Payoneer', commissionBps: 420 },
  { name: 'Crypto · USDT', commissionBps: 500 },
];

const TYPES = [
  { name: 'Аккаунты Facebook', color: '#8fa3a8' },
  { name: 'Прокси', color: '#6fa9a0' },
  { name: 'Карты и платёжки', color: '#d2a06a' },
  { name: 'Крео и дизайн', color: '#b4c68c' },
  { name: 'Антидетект', color: '#ce6e58' },
];

async function main() {
  let rule = await prisma.salaryRule.findFirst();
  if (!rule) {
    rule = await prisma.salaryRule.create({
      data: { name: 'Базовая лесенка', tiersJson: JSON.stringify(TIERS) },
    });
    console.log('Создана лесенка ставок: 30 / 40 / 50%');
  } else {
    console.log('Лесенка уже есть, не трогаю');
  }

  // Баеры, заведённые до появления правила, остались без него — привязываем.
  const orphans = await prisma.buyer.updateMany({
    where: { salaryRuleId: null },
    data: { salaryRuleId: rule.id },
  });
  if (orphans.count) console.log(`Привязано баеров к лесенке: ${orphans.count}`);

  for (const method of METHODS) {
    const existing = await prisma.paymentMethod.findUnique({ where: { name: method.name } });
    if (existing) continue;
    await prisma.paymentMethod.create({ data: method });
    console.log(`Платёжка: ${method.name} — ${(method.commissionBps / 100).toFixed(2)}%`);
  }

  for (const type of TYPES) {
    const existing = await prisma.consumableType.findUnique({ where: { name: type.name } });
    if (existing) continue;
    await prisma.consumableType.create({ data: type });
    console.log(`Тип расходника: ${type.name}`);
  }

  console.log('\nГотово. Комиссии и пороги правятся в базе — экран настроек ещё впереди.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
