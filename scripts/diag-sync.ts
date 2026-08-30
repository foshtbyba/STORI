/**
 * Диагностика синка за день — БЕЗ ДОГАДОК:
 *   npx tsx scripts/diag-sync.ts 2026-08-29 SGY
 *
 * Ничего не меняет. Повторяет ровно то, что делает синхронизация (окно в 4 дня,
 * московское время), и показывает для указанного баера:
 *   1) что лежит в отчётах дня в базе;
 *   2) Keitaro: какие кампании привязаны к баеру и сколько дохода по каждому
 *      ДНЮ окна — так видно, не схлопнулись ли дни в один и то ли поле берём;
 *   3) Brocard: сколько расхода по его командам по каждому дню окна.
 */
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();
const TZ = process.env.SYNC_TZ || 'Europe/Moscow';

function windowDays(date: string, count = 4) {
  const out: string[] = [];
  const d = new Date(`${date}T00:00:00.000Z`);
  for (let i = count - 1; i >= 0; i -= 1) {
    const x = new Date(d);
    x.setUTCDate(x.getUTCDate() - i);
    out.push(x.toISOString().slice(0, 10));
  }
  return out;
}

async function main() {
  const date = process.argv[2];
  const handle = process.argv[3];
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !handle) {
    console.error('npx tsx scripts/diag-sync.ts 2026-08-29 SGY');
    process.exit(1);
  }
  const days = windowDays(date);
  const from = days[0];
  const to = days[days.length - 1];
  console.log(`Окно синка (МСК): ${from} … ${to}, часовой пояс ${TZ}\n`);

  const buyer = await db.buyer.findFirst({ where: { handle } });
  if (!buyer) {
    console.error(`Баер ${handle} не найден`);
    process.exit(1);
  }

  // ── 1. База ────────────────────────────────────────────────────────────
  const rows = await db.dayReport.findMany({
    where: {
      buyerId: buyer.id,
      date: { gte: new Date(`${from}T00:00:00Z`), lt: new Date(`${to}T00:00:00Z`) },
    },
    orderBy: { date: 'asc' },
  });
  console.log('=== БАЗА (отчёты дня баера в окне) ===');
  for (const r of rows) {
    console.log(
      `${r.date.toISOString().slice(0, 10)} | доход=$${(r.revenueCents / 100).toFixed(0)} ` +
        `расход=$${(r.spendNetCents / 100).toFixed(0)} | синк-доход=${r.revenueSyncedCents} синк-расход=${r.spendSyncedCents}`,
    );
  }

  // ── 2. Keitaro по дням ─────────────────────────────────────────────────
  const tracker = await db.tracker.findFirst();
  if (tracker) {
    const base = tracker.baseUrl.trim().replace(/\/+$/, '').replace(/\/admin_api(\/v1)?$/, '');
    const H = { 'Api-Key': tracker.apiKey, 'Content-Type': 'application/json', Accept: 'application/json' };

    // Кампании баера = кампании, чья группа привязана к нему.
    const myGroups = new Set(
      (await db.trackerGroup.findMany({ where: { buyerId: buyer.id } })).map((g) => g.externalId),
    );
    const campRes = await fetch(`${base}/admin_api/v1/campaigns`, { headers: H });
    const camps = (await campRes.json()) as Record<string, unknown>[];
    const myCamps = new Set(
      camps
        .filter((c) => {
          const gid = String((c.group as { id?: unknown })?.id ?? c.group_id ?? '');
          return myGroups.has(gid);
        })
        .map((c) => String(c.id)),
    );
    console.log(`\n=== KEITARO: групп у баера ${myGroups.size}, кампаний ${myCamps.size} ===`);

    // Все группы с числом кампаний — чтобы увидеть, та ли группа у SGY.
    const groupCount = new Map<string, { name: string; n: number }>();
    for (const c of camps) {
      const g = (c.group ?? {}) as { id?: unknown; name?: unknown };
      const gid = String(g.id ?? c.group_id ?? '');
      const cur = groupCount.get(gid) ?? { name: String(g.name ?? '') || gid, n: 0 };
      cur.n += 1;
      groupCount.set(gid, cur);
    }
    console.log('Группы Keitaro (id · кампаний · название):');
    for (const [gid, { name, n }] of [...groupCount.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 20)) {
      console.log(`  ${myGroups.has(gid) ? '→ SGY' : '     '} ${gid} · ${n} камп. · ${name}`);
    }

    // Просим отчёт с набором метрик. Разные сборки Keitaro знают разные имена
    // «подтверждённого дохода», поэтому кандидатов много: неизвестные Keitaro
    // просто не вернёт, и это не сломает запрос. Ищем, какое поле = 101.
    const METRICS = [
      'conversions', 'leads', 'sales', 'revenue', 'sale_revenue', 'profit',
      'confirmed_revenue', 'approved_revenue', 'pending_revenue', 'rejected_revenue',
      'lead_revenue', 'income',
    ];
    const rep = await fetch(`${base}/admin_api/v1/report/build`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify({
        range: { from, to, timezone: TZ },
        grouping: ['day', 'campaign_id'],
        metrics: METRICS,
        filters: [],
        limit: 10000,
      }),
    });
    const j = (await rep.json()) as { rows?: Record<string, unknown>[] };
    // Какие метрики Keitaro реально вернул (по первой строке).
    const present = METRICS.filter((m) => (j.rows ?? []).some((r) => m in r));
    console.log('метрики, которые Keitaro отдал:', present.join(', ') || '—');
    const perDay = new Map<string, Record<string, number>>();
    for (const row of j.rows ?? []) {
      const day = String(row.day ?? row.date ?? '').slice(0, 10);
      if (!myCamps.has(String(row.campaign_id ?? ''))) continue;
      const acc = perDay.get(day) ?? {};
      for (const m of present) acc[m] = (acc[m] ?? 0) + (Number(row[m]) || 0);
      perDay.set(day, acc);
    }
    console.log('СУММЫ метрик SGY по дням — ищи, где 101:');
    for (const d of days) {
      const a = perDay.get(d) ?? {};
      console.log(`  ${d}: ` + present.map((m) => `${m}=${(a[m] ?? 0).toFixed(0)}`).join('  '));
    }
  }

  // ── 3. Brocard по дням ─────────────────────────────────────────────────
  const brocard = await db.brocardConfig.findFirst();
  if (brocard) {
    const myTeams = new Set(
      (await db.brocardTeam.findMany({ where: { buyerId: buyer.id } })).map((t) => t.externalId),
    );
    console.log(`\n=== BROCARD: команд у баера ${myTeams.size} (${[...myTeams].join(', ')}) ===`);
    console.log('РАСХОД баера по дням:');
    for (const d of days) {
      const url = new URL('https://private.mybrocard.com/api/v2/payments');
      url.searchParams.set('tz', TZ);
      url.searchParams.set('per_page', '100');
      url.searchParams.set('dates[begin]', d);
      url.searchParams.set('dates[end]', d);
      let amount = 0; // тело прошедших = чистый расход на рекламу
      let fee = 0; // комиссия со всех, включая отклонённые
      let count = 0;
      for (let page = 1; page <= 20; page += 1) {
        url.searchParams.set('page', String(page));
        const res = await fetch(url, { headers: { Authorization: `Bearer ${brocard.apiKey}`, Accept: 'application/json' } });
        const j = (await res.json()) as { data?: Record<string, unknown>[]; last_page?: number };
        for (const p of j.data ?? []) {
          if (p.is_micro === true) continue;
          const team = String(((p.user as { team?: { id?: unknown } })?.team?.id) ?? '');
          if (!myTeams.has(team)) continue;
          const fees = (p.fees ?? []) as { amount?: unknown }[];
          fee += fees.reduce((s, f) => s + Number(f.amount ?? 0), 0);
          if (!p.decline) amount += Number(p.amount ?? 0);
          count += 1;
        }
        if (page >= Number(j.last_page ?? 1)) break;
      }
      console.log(
        `  ${d}: чистыми $${amount.toFixed(2)} + комиссия $${fee.toFixed(2)} = $${(amount + fee).toFixed(2)} (${count} платежей)`,
      );
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
