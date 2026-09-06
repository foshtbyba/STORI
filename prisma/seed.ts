import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

/** Deterministic jitter so a reseed always produces the same-looking month. */
function wobble(i: number) {
  const v = Math.sin(i * 12.9898) * 43758.5453;
  return v - Math.floor(v);
}

/** Split a total across n days with variation, exact to the last cent. */
function split(total: number, n: number, salt: number) {
  const weights = Array.from({ length: n }, (_, i) => 0.55 + wobble(i + salt) * 0.9);
  const sumW = weights.reduce((a, b) => a + b, 0);
  const parts = weights.map((w) => Math.round((total * w) / sumW));
  const drift = total - parts.reduce((a, b) => a + b, 0);
  parts[parts.length - 1] += drift;
  return parts;
}

const BUYERS = [
  { handle: 'NOMAD', initials: 'NM', color: '#b4c68c', source: 'Facebook', rev: 41_200_00, net: 27_400_00, gross: 28_600_00, cons: 900_00, bonus: 2_500_00 },
  { handle: 'SKO', initials: 'SK', color: '#e4e4e4', source: 'Facebook', rev: 30_800_00, net: 20_900_00, gross: 21_800_00, cons: 650_00, bonus: 0 },
  { handle: 'LUNA', initials: 'LN', color: '#6fa9a0', source: 'TikTok', rev: 24_600_00, net: 16_000_00, gross: 16_700_00, cons: 600_00, bonus: 0 },
  { handle: 'VIPER', initials: 'VP', color: '#8fa3a8', source: 'Facebook', rev: 18_900_00, net: 14_100_00, gross: 14_700_00, cons: 500_00, bonus: 0 },
  { handle: 'ARTEM', initials: 'AR', color: '#ce6e58', source: 'Google UAC', rev: 12_500_00, net: 11_000_00, gross: 11_500_00, cons: 450_00, bonus: 0 },
];

const OFFERS = [
  { name: 'VitaJoint Forte', vertical: 'Nutra · суставы', network: 'Everad', status: 'ACTIVE', geos: ['IT', 'ES', 'PT'], bans: ['Google Ads', 'инцент'], notes: ['Апрув выше на возрасте 45+', 'Лендинг только на местном языке'] },
  { name: 'Keto Slim Pro', vertical: 'Nutra · похудение', network: 'Adcombo', status: 'ACTIVE', geos: ['DE', 'AT', 'CH'], bans: ['бренд-беттинг', 'инцент', 'спам'], notes: ['Кап 150 в день, к обеду обычно выбран', 'До/после в крео — запрещено'] },
  { name: 'SlimTea Detox', vertical: 'Nutra · детокс', network: 'Everad', status: 'ACTIVE', geos: ['RO', 'BG', 'HU'], bans: ['инцент'], notes: ['Принимают только COD-заявки', 'Колл-центр работает до 20:00'] },
  { name: 'CryptoEdge', vertical: 'Finance · трейдинг', network: 'Leadrock', status: 'PAUSED', geos: ['PL', 'CZ', 'SK'], bans: ['Google Ads', 'обещания дохода'], notes: ['На паузе до новых условий', 'Нужен дисклеймер о рисках'] },
  { name: 'GlucoBalance', vertical: 'Nutra · диабет', network: 'Adcombo', status: 'TEST', geos: ['FR', 'BE'], bans: ['мед. заявления', 'инцент'], notes: ['Тестовый залив, лимит $300 в день'] },
  { name: 'AutoLoan Fast', vertical: 'Finance · займы', network: 'Leadrock', status: 'DEAD', geos: ['MX', 'CO'], bans: ['брендовый трафик'], notes: ['Рекламодатель закрыл направление'] },
];

const CONSUMABLE_TYPES = [
  { name: 'Аккаунты Facebook', color: '#8fa3a8' },
  { name: 'Прокси', color: '#6fa9a0' },
  { name: 'Карты и платёжки', color: '#d2a06a' },
  { name: 'Крео и дизайн', color: '#b4c68c' },
  { name: 'Антидетект', color: '#ce6e58' },
];

async function main() {
  // Wipe in dependency order so a reseed is repeatable.
  await prisma.auditLog.deleteMany();
  await prisma.payout.deleteMany();
  await prisma.bonus.deleteMany();
  await prisma.consumableEntry.deleteMany();
  await prisma.dayReport.deleteMany();
  await prisma.consumableType.deleteMany();
  await prisma.offer.deleteMany();
  await prisma.paymentMethod.deleteMany();
  await prisma.period.deleteMany();
  await prisma.buyer.deleteMany();
  await prisma.salaryRule.deleteMany();
  await prisma.team.deleteMany();
  await prisma.user.deleteMany();

  const rule = await prisma.salaryRule.create({
    data: {
      name: 'Базовая лесенка',
      tiersJson: JSON.stringify([
        { fromCents: 80_000, ratePct: 30 },
        { fromCents: 160_000, ratePct: 30 },
        { fromCents: 240_000, ratePct: 30 },
        { fromCents: 500_000, ratePct: 40 },
        { fromCents: 1_000_000, ratePct: 50 },
      ]),
    },
  });

  const methods = await Promise.all(
    [
      { name: 'Wise', commissionBps: 450 },
      { name: 'Payoneer', commissionBps: 420 },
      { name: 'Crypto · USDT', commissionBps: 500 },
    ].map((m) => prisma.paymentMethod.create({ data: m })),
  );

  const offers = await Promise.all(
    OFFERS.map((o) =>
      prisma.offer.create({
        data: {
          name: o.name, vertical: o.vertical, network: o.network, status: o.status,
          geosJson: JSON.stringify(o.geos),
          bansJson: JSON.stringify(o.bans),
          notesJson: JSON.stringify(o.notes),
        },
      }),
    ),
  );

  const types = await Promise.all(
    CONSUMABLE_TYPES.map((t) => prisma.consumableType.create({ data: t })),
  );

  const password = await bcrypt.hash('stori', 10);
  const admin = await prisma.user.create({
    data: { email: 'admin@ms.team', passwordHash: password, name: 'Админ', role: 'ADMIN' },
  });

  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const key = `${year}-${String(month + 1).padStart(2, '0')}`;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const upTo = Math.min(now.getUTCDate(), lastDay);
  const days = Math.max(1, upTo);

  await prisma.period.create({ data: { key, rubPerUsd: 8000 } });

  for (const [bi, b] of BUYERS.entries()) {
    const user = await prisma.user.create({
      data: {
        email: `${b.handle.toLowerCase()}@ms.team`,
        passwordHash: password,
        name: b.handle,
        role: 'BUYER',
      },
    });
    const buyer = await prisma.buyer.create({
      data: {
        userId: user.id,
        handle: b.handle,
        initials: b.initials,
        color: b.color,
        source: b.source,
        salaryRuleId: rule.id,
      },
    });

    // Pick the working days first, then split the period totals across exactly
    // those — otherwise skipping a day would quietly shrink the month.
    const active: number[] = [];
    for (let d = 0; d < days; d++) if (wobble(d + bi * 31) >= 0.12) active.push(d);
    if (active.length === 0) active.push(0);

    const revs = split(b.rev, active.length, bi * 17);
    const nets = split(b.net, active.length, bi * 17 + 5);
    const grosses = split(b.gross, active.length, bi * 17 + 5);

    for (const [i, d] of active.entries()) {
      const method = methods[(d + bi) % methods.length];
      const offer = offers[(d + bi) % 3];
      await prisma.dayReport.create({
        data: {
          date: new Date(Date.UTC(year, month, d + 1)),
          buyerId: buyer.id,
          offerId: offer.id,
          source: b.source,
          revenueCents: revs[i],
          spendNetCents: nets[i],
          paymentMethodId: method.id,
          commissionBps: Math.round((grosses[i] / Math.max(1, nets[i]) - 1) * 10_000),
          spendGrossCents: grosses[i],
        },
      });
    }

    const shares = split(b.cons, types.length, bi * 7);
    for (const [ti, type] of types.entries()) {
      if (shares[ti] <= 0) continue;
      await prisma.consumableEntry.create({
        data: {
          date: new Date(Date.UTC(year, month, Math.min(days, 3 + ti * 4))),
          typeId: type.id,
          buyerId: buyer.id,
          qty: 1 + (ti % 4),
          totalCents: shares[ti],
        },
      });
    }

    if (b.bonus) {
      await prisma.bonus.create({
        data: {
          buyerId: buyer.id,
          periodKey: key,
          amountCents: b.bonus,
          note: 'Первое закрытие $5 000 — 200 000 ₽ на руки',
        },
      });
    }
  }

  await prisma.setting.upsert({
    where: { key: 'seeded' },
    create: { key: 'seeded', value: new Date().toISOString() },
    update: { value: new Date().toISOString() },
  });

  console.log(`Готово. Период ${key}, ${BUYERS.length} баеров.`);
  console.log('Вход: admin@ms.team / stori (баеры — nomad@ms.team и т.д., пароль тот же)');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
