import 'server-only';
import { prisma } from './db';
import { periodRange, periodKeyOf, dayKey, daysOfRange, weekKey, weekBounds, rangeOf, titleOf, weeksOfRange, periodLabel } from './period';
import { profitOf, sum, grossUp, ceilDollars, DEFAULT_COMMISSION_BPS } from './money';
import { computePayout, parseTiers, DEFAULT_TIERS, okladCents, DEFAULT_FIXED_RUB } from './salary';
import { carriedDebt, type WeekBase } from './carry';
import { fetchRate, rateIsStale } from './rate';

export async function getPeriod(key: string) {
  // Первый заход в новую неделю приходит сразу с нескольких серверных
  // компонентов одной страницы. Пара «найти и создать» на этом гонится:
  // все промахиваются мимо пустой таблицы и лезут вставлять, побеждает один,
  // остальные падают на уникальном ключе. Поэтому вставка атомарная, а гонку
  // на уровне базы гасим повторным чтением.
  let period;
  try {
    period = await prisma.period.upsert({ where: { key }, update: {}, create: { key } });
  } catch {
    const existing = await prisma.period.findUnique({ where: { key } });
    if (!existing) throw new Error(`Не удалось завести период ${key}.`);
    period = existing;
  }

  // Закрытый период держит курс, при котором считалась выплата, — трогать его
  // нельзя. Ручной курс тоже не перезаписываем: его выставили осознанно.
  if (period.status === 'CLOSED' || period.rateSource === 'MANUAL') return period;

  // Прошедшую неделю не трогаем: как только неделя закончилась, её курс
  // заморожен на том значении, что стояло по ходу недели. Иначе, зайдя в старый
  // период, мы бы подтянули сегодняшний курс и пересчитали давнюю зарплату по
  // нему. Автоматически обновляем курс только у текущей (ещё не завершённой)
  // недели. Месячные ключи (посещаемость) курс не считают — их пропускаем.
  const { to } = rangeOf(key);
  if (to.getTime() <= Date.now()) return period;

  if (!rateIsStale(period.rateUpdatedAt)) return period;

  const fetched = await fetchRate();
  if (!fetched) return period;

  return prisma.period.update({
    where: { id: period.id },
    data: { rubPerUsd: fetched.hundredths, rateUpdatedAt: new Date() },
  });
}

export async function currentPeriodKey() {
  return periodKeyOf(new Date());
}

export type BuyerRow = Awaited<ReturnType<typeof teamSummary>>['buyers'][number];

/** Отрезок, за который считаем. По умолчанию — весь месяц периода. */
export type Range = { from: Date; to: Date };

/**
 * Всё, что нужно командным экранам, за один проход.
 *
 * `key` — расчётный период (месяц): по нему берутся курс и разовые бонусы, по
 * нему же закрывается выплата. `range` сужает счёт до нужного отрезка —
 * сводка и гора смотрят на текущую неделю, а зарплата на весь месяц.
 */
/**
 * Неперекрытый минус, который люди притащили из недель ДО `before`.
 *
 * Считаем из истории, а не храним отдельной цифрой: хвост — это производная от
 * отчётов, и любая правка старого дня должна его пересчитывать сама. Хранимое
 * поле в этом месте разъехалось бы с отчётами на первой же правке задним
 * числом, и никто бы этого не заметил.
 *
 * Всё берём двумя запросами и складываем по неделям в памяти: недель у команды
 * десятки, а не миллионы, и ходить в базу за каждой — впустую.
 */
async function carriedByBuyer(
  before: Date,
  charged: Map<string, boolean>,
  fixedRubBy: Map<string, number>,
  fallbackRate: number,
) {
  const ids = [...charged.keys()];
  if (ids.length === 0) return new Map<string, number>();

  const [days, consumables, periods] = await Promise.all([
    prisma.dayReport.findMany({
      where: { date: { lt: before }, buyerId: { in: ids } },
      select: { buyerId: true, date: true, revenueCents: true, spendGrossCents: true },
    }),
    prisma.consumableEntry.findMany({
      where: { date: { lt: before }, buyerId: { in: ids } },
      select: { buyerId: true, date: true, totalCents: true },
    }),
    // Курс каждой недели — чтобы перевести рублёвый оклад в доллары так же, как
    // он был выплачен. Недели без периода считаем по текущему курсу.
    prisma.period.findMany({ select: { key: true, rubPerUsd: true } }),
  ]);
  const rateByWeek = new Map(periods.map((p) => [p.key, p.rubPerUsd]));

  /** баер → неделя → база этой недели. */
  const byBuyer = new Map<string, Map<string, number>>();
  const add = (buyerId: string, date: Date, cents: number) => {
    if (!charged.has(buyerId)) return;
    const weeks = byBuyer.get(buyerId) ?? new Map<string, number>();
    const key = weekKey(date);
    weeks.set(key, (weeks.get(key) ?? 0) + cents);
    byBuyer.set(buyerId, weeks);
  };

  for (const d of days) add(d.buyerId, d.date, d.revenueCents - d.spendGrossCents);
  // Расходники входят в базу только у тех, кому они заряжены, — ровно как в
  // computePayout. Иначе хвост считался бы по одному правилу, а зарплата по
  // другому, и человек не сошёлся бы сам с собой.
  for (const c of consumables) {
    if (!c.buyerId || !charged.get(c.buyerId)) continue;
    add(c.buyerId, c.date, -c.totalCents);
  }

  const out = new Map<string, number>();
  for (const [buyerId, weeks] of byBuyer) {
    const fixedRub = fixedRubBy.get(buyerId) ?? DEFAULT_FIXED_RUB;
    const rows: WeekBase[] = [...weeks].map(([wk, baseCents]) => ({
      weekKey: wk,
      baseCents,
      // Оклад для недели считаем по её курсу; уйдёт в долг только если неделя
      // минусовая (см. carriedDebt).
      okladCents: okladCents(fixedRub, rateByWeek.get(wk) ?? fallbackRate),
    }));
    out.set(buyerId, carriedDebt(rows));
  }
  return out;
}

export async function teamSummary(key: string, range?: Range, opts?: { owners?: boolean }) {
  const { from, to } = range ?? periodRange(key);
  const [period, allBuyers, days, consumables, bonuses] = await Promise.all([
    getPeriod(key),
    prisma.buyer.findMany({
      where: { archived: false },
      include: { user: true, salaryRule: true },
      orderBy: { handle: 'asc' },
    }),
    prisma.dayReport.findMany({ where: { date: { gte: from, lt: to } } }),
    prisma.consumableEntry.findMany({
      where: { date: { gte: from, lt: to } },
      include: { type: true },
    }),
    prisma.bonus.findMany({ where: { periodKey: key } }),
  ]);

  // Овнеры и баеры считаются раздельными листами и никогда не смешиваются:
  // командный отчёт не видит овнеров вовсе, а лист овнеров — только их.
  // Баер, кроме того, попадает в лист, только если к концу отрезка он уже вышел
  // в команду: неделю, целиком прошедшую до его даты выхода, не показываем и
  // оклад за неё не платим — до прихода человека платить было не за что. `to` —
  // граница отрезка (следующий понедельник), поэтому вышедший в любой день
  // недели (startedAt < to) в неё уже входит.
  const buyers = opts?.owners
    ? allBuyers.filter((b) => b.owner)
    : allBuyers.filter(
        (b) => !b.owner && (!b.startedAt || b.startedAt.getTime() < to.getTime()),
      );

  // Будущая неделя ещё не наступила — оклад за неё не начисляем. Работы не
  // было, платить не за что; профит и так ноль. Как только неделя началась
  // (from <= сейчас), оклад считается как обычно.
  const upcoming = from.getTime() > Date.now();

  // Хвост минуса с прошлых недель. Считаем по тем же людям и тому же правилу
  // про расходники, что и зарплату, — иначе цифры разойдутся.
  const carried = await carriedByBuyer(
    from,
    new Map(buyers.map((b) => [b.id, b.consumablesAffectSalary])),
    new Map(buyers.map((b) => [b.id, b.salaryRule?.fixedRub ?? DEFAULT_FIXED_RUB])),
    period.rubPerUsd,
  );

  const rows = buyers.map((buyer) => {
    const mine = days.filter((d) => d.buyerId === buyer.id);
    const revenueCents = sum(mine, (d) => d.revenueCents);
    const spendNetCents = sum(mine, (d) => d.spendNetCents);
    const spendGrossCents = sum(mine, (d) => d.spendGrossCents);
    const profitCents = revenueCents - spendGrossCents;
    const consumableCents = sum(
      consumables.filter((c) => c.buyerId === buyer.id),
      (c) => c.totalCents,
    );
    const bonusCents = sum(bonuses.filter((b) => b.buyerId === buyer.id), (b) => b.amountCents);
    const payout = computePayout({
      profitCents,
      consumableCents,
      consumablesAffectSalary: buyer.consumablesAffectSalary,
      tiers: parseTiers(buyer.salaryRule?.tiersJson),
      fixedRub: buyer.salaryRule?.fixedRub,
      rubPerUsd: period.rubPerUsd,
      bonusCents,
      carriedCents: carried.get(buyer.id) ?? 0,
    });
    // Будущую неделю обнуляем по деньгам: ни оклада, ни ставки — только бонусы,
    // если их вдруг проставили заранее. Статистику (профит, ROI) не трогаем.
    const eff = upcoming
      ? {
          ...payout,
          salaryCents: 0,
          tierCents: 0,
          fixedCents: 0,
          onOklad: false,
          totalCents: payout.bonusCents,
          // Работы ещё не было: хвост её не гасил и не рос — он просто ждёт.
          carryCoveredCents: 0,
          carryOutCents: payout.carriedCents,
        }
      : payout;

    return {
      buyer,
      days: mine.length,
      revenueCents,
      spendNetCents,
      spendGrossCents,
      profitCents,
      consumableCents,
      roi: spendGrossCents ? (profitCents / spendGrossCents) * 100 : 0,
      /**
       * Чистыми — то, что осталось после расходников. Именно эта сумма идёт в
       * зарплатную базу, по ней же считается высота на горе: иначе человек
       * видит на склоне одну цифру, а в расчёте другую.
       */
      netCents: buyer.consumablesAffectSalary ? profitCents - consumableCents : profitCents,
      ...eff,
    };
  });

  const ranked = [...rows].sort((a, b) => b.netCents - a.netCents);

  // Считаем и показываем только по активным баерам. Профит и так берётся по
  // ним, а вот расходники и сырой список дней приходят по всей базе: если их
  // не отфильтровать, архивный баер попадёт в график и в расходники, но не в
  // заголовок — и цифры перестанут сходиться. Расходники команды (без баера)
  // оставляем: они общие.
  const activeIds = new Set(buyers.map((b) => b.id));
  const shownConsumables = consumables.filter((c) => !c.buyerId || activeIds.has(c.buyerId));
  const shownDays = days.filter((d) => activeIds.has(d.buyerId));

  const totals = {
    revenueCents: sum(rows, (r) => r.revenueCents),
    spendNetCents: sum(rows, (r) => r.spendNetCents),
    spendGrossCents: sum(rows, (r) => r.spendGrossCents),
    profitCents: sum(rows, (r) => r.profitCents),
    consumableCents: sum(shownConsumables, (c) => c.totalCents),
    netCents: sum(rows, (r) => r.netCents),
    salaryCents: sum(rows, (r) => r.salaryCents),
    bonusCents: sum(rows, (r) => r.bonusCents),
    payoutCents: sum(rows, (r) => r.totalCents),
    /** Минус, пришедший с прошлых недель, и что из него уедет дальше. */
    carriedCents: sum(rows, (r) => r.carriedCents),
    carryOutCents: sum(rows, (r) => r.carryOutCents),
  };

  return {
    period,
    buyers: ranked,
    totals: {
      ...totals,
      commissionCents: totals.spendGrossCents - totals.spendNetCents,
      roi: totals.spendGrossCents ? (totals.profitCents / totals.spendGrossCents) * 100 : 0,
      // Расходники в остаток НЕ вычитаем: их покрывает баер своим плюсом (и они
      // уже уменьшают его базу зарплаты). Команде остаётся профит за вычетом
      // только выплат баерам.
      teamNetCents: totals.profitCents - totals.payoutCents,
    },
    consumables: shownConsumables,
    days: shownDays,
  };
}

export async function buyerSummary(buyerId: string, key: string, range?: Range) {
  const { from, to } = range ?? periodRange(key);
  const [period, buyer, days, consumables, bonuses] = await Promise.all([
    getPeriod(key),
    prisma.buyer.findUnique({ where: { id: buyerId }, include: { user: true, salaryRule: true } }),
    prisma.dayReport.findMany({
      where: { buyerId, date: { gte: from, lt: to } },
      orderBy: { date: 'asc' },
    }),
    prisma.consumableEntry.findMany({
      where: { buyerId, date: { gte: from, lt: to } },
      include: { type: true },
      orderBy: { date: 'desc' },
    }),
    prisma.bonus.findMany({ where: { buyerId, periodKey: key } }),
  ]);
  // Итог за всё время — по всем отчётам баера, без границ периода. Расходники
  // вычитаем и здесь: у админа в таблице стоит та же цифра, и расходиться они
  // не должны.
  const [lifetime, lifetimeSpent] = await Promise.all([
    prisma.dayReport.aggregate({
      where: { buyerId },
      _sum: { revenueCents: true, spendGrossCents: true },
    }),
    prisma.consumableEntry.aggregate({ where: { buyerId }, _sum: { totalCents: true } }),
  ]);
  if (!buyer) return null;

  const revenueCents = sum(days, (d) => d.revenueCents);
  const spendNetCents = sum(days, (d) => d.spendNetCents);
  const spendGrossCents = sum(days, (d) => d.spendGrossCents);
  const profitCents = revenueCents - spendGrossCents;
  const consumableCents = sum(consumables, (c) => c.totalCents);
  const carried = await carriedByBuyer(
    from,
    new Map([[buyer.id, buyer.consumablesAffectSalary]]),
    new Map([[buyer.id, buyer.salaryRule?.fixedRub ?? DEFAULT_FIXED_RUB]]),
    period.rubPerUsd,
  );
  const payout = computePayout({
    profitCents,
    consumableCents,
    consumablesAffectSalary: buyer.consumablesAffectSalary,
    tiers: parseTiers(buyer.salaryRule?.tiersJson),
    fixedRub: buyer.salaryRule?.fixedRub,
    rubPerUsd: period.rubPerUsd,
    bonusCents: sum(bonuses, (b) => b.amountCents),
    carriedCents: carried.get(buyer.id) ?? 0,
  });

  return {
    period,
    buyer,
    days,
    consumables,
    allTimeCents:
      (lifetime._sum.revenueCents ?? 0) -
      (lifetime._sum.spendGrossCents ?? 0) -
      (buyer.consumablesAffectSalary ? (lifetimeSpent._sum.totalCents ?? 0) : 0),
    /** Чистыми за отрезок — профит за вычетом своих расходников. */
    netCents: buyer.consumablesAffectSalary
      ? profitCents - consumableCents
      : profitCents,
    revenueCents,
    spendNetCents,
    spendGrossCents,
    commissionCents: spendGrossCents - spendNetCents,
    profitCents,
    consumableCents,
    roi: spendGrossCents ? (profitCents / spendGrossCents) * 100 : 0,
    tiers: parseTiers(buyer.salaryRule?.tiersJson),
    ...payout,
  };
}

export async function defaultTiers() {
  const rule = await prisma.salaryRule.findFirst();
  return parseTiers(rule?.tiersJson) ?? DEFAULT_TIERS;
}

/**
 * Кто первым в периоде перешагнул отметку по накопленному профиту и когда.
 * Нужно для разового бонуса «за первые $5 000»: правило про того, кто дошёл
 * раньше всех, а не про того, у кого больше всего на конец месяца.
 */
export async function firstToCross(key: string, thresholdCents: number) {
  const { from, to } = periodRange(key);
  const [days, buyers] = await Promise.all([
    prisma.dayReport.findMany({
      where: { date: { gte: from, lt: to } },
      orderBy: { date: 'asc' },
    }),
    prisma.buyer.findMany({ where: { archived: false, owner: false } }),
  ]);
  // Овнер в командном бонусе не участвует: его дни в гонку за порогом не берём.
  const buyerIds = new Set(buyers.map((b) => b.id));

  const running = new Map<string, number>();
  const reached: { buyerId: string; date: Date }[] = [];
  for (const day of days) {
    if (!buyerIds.has(day.buyerId)) continue;
    if (reached.some((r) => r.buyerId === day.buyerId)) continue;
    const total = (running.get(day.buyerId) ?? 0) + profitOf(day);
    running.set(day.buyerId, total);
    if (total >= thresholdCents) reached.push({ buyerId: day.buyerId, date: day.date });
  }
  if (reached.length === 0) return null;

  // Дни отсортированы по дате, значит первый в списке и есть первый по времени.
  const winner = reached[0];
  const buyer = buyers.find((b) => b.id === winner.buyerId);
  return buyer ? { buyer, date: winner.date } : null;
}

/**
 * Чистый профит каждого баера за всё время — по всем отчётам, без границ
 * периода. Нужен на главной: месяц показывает форму, а эта цифра — сколько
 * человек принёс команде вообще.
 */
export async function allTimeProfit(opts?: { owners?: boolean }) {
  // Расходники вычитаем и здесь: иначе «за всё время» считается по одному
  // правилу, а недельный профит по другому, и цифры рядом не сходятся.
  const [days, spent, buyers] = await Promise.all([
    prisma.dayReport.groupBy({
      by: ['buyerId'],
      _sum: { revenueCents: true, spendGrossCents: true },
    }),
    prisma.consumableEntry.groupBy({ by: ['buyerId'], _sum: { totalCents: true } }),
    // По умолчанию только баеры (овнеры в командный итог не входят). Для листа
    // овнеров считаем их же — отдельным вызовом.
    prisma.buyer.findMany({ where: { owner: !!opts?.owners }, select: { id: true, consumablesAffectSalary: true } }),
  ]);

  const charged = new Map(buyers.map((b) => [b.id, b.consumablesAffectSalary]));
  const byBuyer = new Map<string, number>();
  for (const r of days) {
    if (!charged.has(r.buyerId)) continue;
    byBuyer.set(r.buyerId, (r._sum.revenueCents ?? 0) - (r._sum.spendGrossCents ?? 0));
  }
  for (const c of spent) {
    if (!c.buyerId || !charged.get(c.buyerId)) continue;
    byBuyer.set(c.buyerId, (byBuyer.get(c.buyerId) ?? 0) - (c._sum.totalCents ?? 0));
  }
  return byBuyer;
}

/**
 * Архив закрытых расчётных листов: когда период закрыли и сколько по нему
 * ушло людям. Закрытый лист уже не пересчитывается — но посмотреть, кто
 * сколько получил в марте, нужно регулярно.
 *
 * `buyerId` сужает архив до одного человека: баер видит только свои выплаты.
 */
export async function closedSheets(buyerId?: string, limit = 12) {
  const periods = await prisma.period.findMany({
    where: { status: 'CLOSED' },
    orderBy: { key: 'desc' },
    take: limit,
  });
  if (periods.length === 0) return [];

  const sheets = await Promise.all(
    periods.map(async (period) => {
      // Лист считается за свой же отрезок — неделю или, у старых листов, месяц.
      const summary = await teamSummary(period.key, rangeOf(period.key));
      const rows = buyerId
        ? summary.buyers.filter((r) => r.buyer.id === buyerId)
        : summary.buyers;
      return {
        key: period.key,
        title: titleOf(period.key),
        closedAt: period.closedAt,
        rate: period.rubPerUsd,
        payoutCents: sum(rows, (r) => r.totalCents),
        salaryCents: sum(rows, (r) => r.salaryCents),
        bonusCents: sum(rows, (r) => r.bonusCents),
        people: rows.filter((r) => r.totalCents > 0).length,
      };
    }),
  );
  return sheets;
}

/**
 * Зарплата за отрезок шире недели — суммой недельных листов.
 *
 * Ставка берётся от базы за неделю, и считать её от месячной суммы нельзя:
 * месяц уводит человека на верхний порог, которого в реальных выплатах не
 * было. Поэтому месяц на сводке — это сложенные недели, ровно те же цифры,
 * что человек увидит в расчётных листах.
 */
/**
 * Расходники на команду по месяцам («общак» в Brocard). Расходники идут
 * помесячно, поэтому и показываем их разбивкой по месяцам, а не по неделям.
 * Сумму накручиваем той же комиссией за пополнение (4,5%), что и весь расход.
 */
export async function overheadMonths(limit = 6) {
  const rows = await prisma.overheadDay.findMany({ orderBy: { date: 'desc' } });
  const byMonth = new Map<string, number>();
  for (const r of rows) {
    const key = `${r.date.getUTCFullYear()}-${String(r.date.getUTCMonth() + 1).padStart(2, '0')}`;
    byMonth.set(key, (byMonth.get(key) ?? 0) + r.spendCents);
  }
  return [...byMonth.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .slice(0, limit)
    .map(([month, netCents]) => ({
      month,
      title: periodLabel(month),
      netCents: ceilDollars(netCents),
      grossCents: ceilDollars(grossUp(netCents, DEFAULT_COMMISSION_BPS)),
    }));
}

export async function payoutAcross(range: Range) {
  const weeks = weeksOfRange(range);
  const sheets = await Promise.all(
    weeks.map((w) => teamSummary(w, weekBounds(w))),
  );
  return {
    weeks: weeks.length,
    salaryCents: sum(sheets, (s) => s.totals.salaryCents),
    bonusCents: sum(sheets, (s) => s.totals.bonusCents),
    payoutCents: sum(sheets, (s) => s.totals.payoutCents),
  };
}
