import { requireUser, scopeBuyerId } from '@/lib/auth';
import { type Role } from '@/lib/roles';
import { prisma } from '@/lib/db';
import { fmtWhen } from '@/lib/period';
import { Panel } from '@/components/ui';
import CampaignsTable, { type AdRow } from '@/components/CampaignsTable';

/**
 * Кампании — таблица статистики по объявлениям из Facebook (референс — FBTOOL).
 *
 * Данные тянет заход `syncFacebookAds` (кнопка «Обновить стату» и крон
 * `?only=ads`) и кладёт в FbAd + FbAdDay. Здесь только показываем: свод сверху,
 * таблица по объявлениям с сортировкой и поиском, и управление (пауза/старт,
 * бюджет). Доход/профит — из Keitaro по ad_id, только для ориентира.
 *
 * Скоуп как в остальной рекламе: баер видит свои объявления, админ — овнерские
 * (SKO/MPR), а не весь скоуп команды.
 */
export default async function CampaignsPage({
  searchParams,
}: {
  searchParams: Promise<{ d?: string; day?: string }>;
}) {
  const user = await requireUser();
  const role = user.role as Role;
  const admin = role === 'ADMIN';
  const scoped = scopeBuyerId(user);

  const { d, day } = await searchParams;
  const dayValid = !!day && /^\d{4}-\d{2}-\d{2}$/.test(day);

  // Окно по календарным дням в UTC (как хранится FbAdDay.date). Либо конкретный
  // день из календаря (?day=YYYY-MM-DD), либо пресет (сегодня/7/14).
  let fromMid: Date;
  let toMid: Date;
  let win: number;
  if (dayValid) {
    const dd = new Date(`${day}T00:00:00.000Z`);
    fromMid = dd;
    toMid = dd;
    win = 1;
  } else {
    win = d === '7' ? 7 : d === '14' ? 14 : 1;
    const today = new Date();
    toMid = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    fromMid = new Date(toMid);
    fromMid.setUTCDate(fromMid.getUTCDate() - (win - 1));
  }

  const where = admin
    ? { adAccount: { adToken: { buyer: { owner: true } } } }
    : { adAccount: { adToken: { buyerId: scoped ?? '__none__' } } };

  // Овнеры для переключателя — берём отдельно, чтобы SKO/MPR были в списке даже
  // если у одного из них за выбранный период нет объявлений.
  const owners = admin
    ? await prisma.buyer.findMany({
        where: { archived: false, owner: true },
        select: { handle: true, initials: true, color: true },
        orderBy: { handle: 'asc' },
      })
    : [];

  const ads = await prisma.fbAd.findMany({
    where,
    include: {
      adAccount: {
        select: {
          name: true,
          externalId: true,
          currency: true,
          adToken: { select: { lastSyncAt: true, buyer: { select: { handle: true, initials: true, color: true, owner: true } } } },
        },
      },
      days: { where: { date: { gte: fromMid, lte: toMid } } },
    },
  });

  const rows: AdRow[] = [];
  let lastSync: Date | null = null;
  for (const a of ads) {
    const t = a.adAccount.adToken.lastSyncAt;
    if (t && (!lastSync || t > lastSync)) lastSync = t;

    let spend = 0, impressions = 0, clicks = 0, leads = 0, revenue = 0;
    for (const day of a.days) {
      spend += day.spendCents;
      impressions += day.impressions;
      clicks += day.clicks;
      leads += day.leads;
      revenue += day.revenueCents;
    }
    // В таблицу — только то, что крутилось в окне.
    if (spend === 0 && impressions === 0) continue;

    rows.push({
      id: a.id,
      adId: a.adId,
      name: a.name,
      status: a.status,
      thumbnailUrl: a.thumbnailUrl,
      linkUrl: a.linkUrl,
      ktToken: a.ktToken,
      adsetName: a.adsetName,
      dailyBudgetCents: a.dailyBudget,
      targeting: a.targeting,
      account: a.adAccount.name || a.adAccount.externalId.replace(/^act_/, ''),
      act: a.adAccount.externalId.replace(/^act_/, ''),
      currency: a.adAccount.currency,
      buyer: a.adAccount.adToken.buyer.handle,
      initials: a.adAccount.adToken.buyer.initials,
      color: a.adAccount.adToken.buyer.color,
      spendCents: spend,
      impressions,
      clicks,
      leads,
      revenueCents: revenue,
    });
  }

  return (
    <div className="flex flex-col gap-3.5">
      <Panel className="p-4 sm:p-6">
        <CampaignsTable rows={rows} win={win} day={dayValid ? day! : ''} owners={owners} admin={admin} updated={lastSync ? fmtWhen(lastSync) : null} />

        <p className="mt-4 text-[11px] leading-relaxed text-dim">
          Расход/клики/показы/лиды — из Facebook по объявлениям. Доход и профит — из Keitaro по
          ad_id (Sub ID 4), для ориентира. Расход по кампаниям параллельно уходит в сам Keitaro.
        </p>
      </Panel>
    </div>
  );
}
