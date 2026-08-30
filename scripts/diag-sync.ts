/**
 * Диагностика синхронизации за один день:
 *   npx tsx scripts/diag-sync.ts 2026-08-29 [handle]
 *
 * Ничего не меняет. Показывает три вещи по указанной дате:
 *   1) что лежит в отчётах дня в базе (и синк это писал или рука);
 *   2) СЫРОЙ ответ Keitaro по кампаниям — все поля выручки, чтобы понять, где
 *      настоящий доход;
 *   3) СЫРЫЕ платежи Brocard — amount, комиссия, статус, команда.
 *
 * По этому выводу видно, какое поле брать за доход и за расход на вашей сборке,
 * — и я поправлю маппинг точно, без догадок. Ключи берутся из базы, никуда не
 * отправляются, только читаются.
 */
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

function pretty(obj: unknown) {
  return JSON.stringify(obj, null, 2);
}

async function main() {
  const date = process.argv[2];
  const handle = process.argv[3];
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error('Укажи дату: npx tsx scripts/diag-sync.ts 2026-08-29 [handle]');
    process.exit(1);
  }
  const from = new Date(`${date}T00:00:00.000Z`);
  const to = new Date(from);
  to.setUTCDate(to.getUTCDate() + 1);

  // ── 1. Что в базе ──────────────────────────────────────────────────────
  const buyers = await db.buyer.findMany({ select: { id: true, handle: true } });
  const byId = new Map(buyers.map((b) => [b.id, b.handle]));
  const rows = await db.dayReport.findMany({
    where: { date: { gte: from, lt: to } },
    orderBy: { buyerId: 'asc' },
  });
  console.log(`\n=== БАЗА: отчёты дня за ${date} ===`);
  for (const r of rows) {
    const h = byId.get(r.buyerId) ?? r.buyerId;
    if (handle && h !== handle) continue;
    console.log(
      `${h} | source=${r.source} offerId=${r.offerId ?? '—'} | ` +
        `доход=$${(r.revenueCents / 100).toFixed(2)} расход=$${(r.spendNetCents / 100).toFixed(2)} ` +
        `сКомиссией=$${(r.spendGrossCents / 100).toFixed(2)} (${(r.commissionBps / 100).toFixed(2)}%) | ` +
        `синк: доход=${r.revenueSyncedCents ?? '—'} расход=${r.spendSyncedCents ?? '—'} ` +
        `${r.syncedAt ? 'был' : 'ручная'} | note="${r.note}"`,
    );
  }

  // ── 2. Keitaro сырой ───────────────────────────────────────────────────
  const tracker = await db.tracker.findFirst();
  if (tracker) {
    const base = tracker.baseUrl.trim().replace(/\/+$/, '').replace(/\/admin_api(\/v1)?$/, '');
    const res = await fetch(`${base}/admin_api/v1/report/build`, {
      method: 'POST',
      headers: { 'Api-Key': tracker.apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        range: { from: date, to: date, timezone: 'UTC' },
        grouping: ['day', 'campaign_id'],
        // Просим ВСЕ похожие на доход метрики, чтобы увидеть, где настоящая.
        metrics: ['conversions', 'sales', 'leads', 'sale_revenue', 'revenue', 'cost', 'profit'],
        filters: [],
        limit: 50,
      }),
    });
    const text = await res.text();
    console.log(`\n=== KEITARO /report/build (${res.status}) ===`);
    try {
      const j = JSON.parse(text);
      console.log('строк:', (j.rows ?? []).length);
      console.log(pretty((j.rows ?? []).slice(0, 8)));
    } catch {
      console.log(text.slice(0, 500));
    }
  } else {
    console.log('\n=== KEITARO: не настроен ===');
  }

  // ── 3. Brocard сырой ───────────────────────────────────────────────────
  const brocard = await db.brocardConfig.findFirst();
  if (brocard) {
    const url = new URL('https://private.mybrocard.com/api/v2/payments');
    url.searchParams.set('tz', 'UTC');
    url.searchParams.set('per_page', '100');
    url.searchParams.set('dates[begin]', date);
    url.searchParams.set('dates[end]', date);
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${brocard.apiKey}`, Accept: 'application/json' },
    });
    const text = await res.text();
    console.log(`\n=== BROCARD /payments (${res.status}) ===`);
    try {
      const j = JSON.parse(text);
      const data = (j.data ?? []) as Record<string, unknown>[];
      console.log('платежей:', data.length, '· страниц:', j.last_page);
      for (const p of data.slice(0, 12)) {
        const user = (p.user ?? {}) as { team?: { id?: unknown; name?: unknown } };
        const fees = (p.fees ?? []) as { amount?: unknown; currency?: unknown }[];
        console.log(
          `id=${p.id} amount=${p.amount} ${p.currency} ` +
            `fees=${fees.map((f) => `${f.amount}${f.currency}`).join('+') || '—'} ` +
            `micro=${p.is_micro} decline=${JSON.stringify(p.decline)} ` +
            `state=${JSON.stringify((p.state as { label?: unknown })?.label)} ` +
            `team=${user.team?.id}/${JSON.stringify(user.team?.name)} date=${p.date}`,
        );
      }
    } catch {
      console.log(text.slice(0, 500));
    }
  } else {
    console.log('\n=== BROCARD: не настроен ===');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
