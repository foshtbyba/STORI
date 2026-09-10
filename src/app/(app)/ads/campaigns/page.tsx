import { requireUser, scopeBuyerId } from '@/lib/auth';
import { type Role } from '@/lib/roles';
import { prisma } from '@/lib/db';
import { fmtWhen } from '@/lib/period';
import { Panel } from '@/components/ui';
import CampaignsTable, { type AdRow } from '@/components/CampaignsTable';
import Tip from '@/components/Tip';

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
  // если у одного из них за выбранный период нет объявлений. Заодно это набор
  // баеров, чей КТ-доход считаем авторитетным для сводки (см. ниже).
  const relevantBuyers = admin
    ? await prisma.buyer.findMany({
        where: { archived: false, owner: true },
        select: { id: true, handle: true, initials: true, color: true },
        orderBy: { handle: 'asc' },
      })
    : scoped
      ? await prisma.buyer.findMany({
          where: { id: scoped },
          select: { id: true, handle: true, initials: true, color: true },
        })
      : [];
  const owners = relevantBuyers.map((b) => ({ handle: b.handle, initials: b.initials, color: b.color }));

  // АВТОРИТЕТНЫЙ доход для сводки — из подтверждённого дохода по кампаниям КТ
  // (KtCampaignDay, поле sale_revenue), а НЕ из суммы по объявлениям. Привязка
  // дохода к объявлению идёт по sub_id_4 (ad_id): конверсии без него (или на
  // объявлении без открута за день) в поад-разрез не попадают и занижают сумму.
  // Здесь берём ту же цифру, что показывает сам Keitaro: доход групп баера за
  // окно. Строки таблицы по-прежнему носят привязанный доход — для ROI по
  // объявлению; расхождение показываем отдельной подписью «без привязки».
  const buyerGroups = relevantBuyers.length
    ? await prisma.trackerGroup.findMany({
        where: { buyerId: { in: relevantBuyers.map((b) => b.id) } },
        select: { externalId: true, buyerId: true },
      })
    : [];
  const groupToBuyer = new Map(buyerGroups.map((g) => [g.externalId, g.buyerId!]));
  const idToHandle = new Map(relevantBuyers.map((b) => [b.id, b.handle]));
  const ktRevenue: Record<string, { revenueCents: number; conversions: number }> = {};
  if (buyerGroups.length) {
    const kcd = await prisma.ktCampaignDay.findMany({
      where: { date: { gte: fromMid, lte: toMid }, groupId: { in: buyerGroups.map((g) => g.externalId) } },
      select: { groupId: true, revenueCents: true, conversions: true },
    });
    for (const r of kcd) {
      const handle = idToHandle.get(groupToBuyer.get(r.groupId) ?? '');
      if (!handle) continue;
      const e = ktRevenue[handle] ?? { revenueCents: 0, conversions: 0 };
      e.revenueCents += r.revenueCents;
      e.conversions += r.conversions;
      ktRevenue[handle] = e;
    }
  }

  // Профили, которые сейчас НЕ обновляются: у токена стоит lastError (сессия
  // слетела и даже авто-подхват из кук не помог, либо кабинет забанен). Их
  // статистика и расход заморожены на моменте до сбоя — это надо явно показать,
  // иначе легко не заметить и лить вслепую.
  const staleWhere = admin
    ? { enabled: true, lastError: { not: '' }, buyer: { owner: true } }
    : { enabled: true, lastError: { not: '' }, buyerId: scoped ?? '__none__' };
  const staleTokens = await prisma.adToken.findMany({
    where: staleWhere,
    select: { label: true, lastError: true, lastSyncAt: true, buyer: { select: { handle: true } } },
    orderBy: { lastSyncAt: 'asc' },
  });
  const stale = staleTokens.map((t) => ({
    who: [t.buyer?.handle, t.label].filter(Boolean).join(' · ') || 'профиль',
    error: t.lastError,
    when: t.lastSyncAt ? fmtWhen(t.lastSyncAt) : null,
  }));

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
    // Раньше тут отбрасывали объявления без открута. Теперь отдаём все, а
    // «с открутом / без открута» переключается фильтром в таблице.
    rows.push({
      id: a.id,
      adId: a.adId,
      name: a.name,
      status: a.status,
      thumbnailUrl: a.thumbnailUrl,
      linkUrl: a.linkUrl,
      ktToken: a.ktToken,
      adsetName: a.adsetName,
      campaignId: a.campaignId,
      campaignName: a.campaignName,
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
      days: a.days
        .filter((d) => d.spendCents > 0)
        .map((d) => ({ date: d.date.toISOString().slice(0, 10), spendCents: d.spendCents }))
        .sort((x, y) => x.date.localeCompare(y.date)),
    });
  }

  return (
    <div className="flex flex-col gap-3.5">
      {stale.length ? (
        <div className="rounded-[18px] border px-4 py-3 text-[12.5px]" style={{ borderColor: '#5a3a2a', background: '#2c1f1a', color: '#ce6e58' }}>
          <div className="font-semibold">⚠ Не обновляются {stale.length} проф.: статистика и расход по ним заморожены</div>
          {/* Компактные плитки в строку — по одной на профиль. Подробности
              (когда обновляли + что делать) — в подсказке при наведении. */}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {stale.map((s, i) => (
              <Tip
                key={i}
                label={
                  <span className="flex flex-col gap-0.5">
                    <span className="font-medium text-text">{s.who}</span>
                    {s.when ? <span className="text-mute">последнее обновление {s.when}</span> : null}
                    <span>Токен слетел — обнови профиль (кнопка «подкинуть токен» в кабинетах) или переоткрой сессию в антидетекте. После — жми «Обновить стату»: пропущенные дни (до 14) догрузятся.</span>
                  </span>
                }
              >
                <span
                  className="inline-flex cursor-help items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] leading-none"
                  style={{ borderColor: '#5a3a2a', background: '#241712' }}
                >
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: '#ce6e58' }} />
                  <span className="font-medium">{s.who}</span>
                  <span className="text-mute">· токен слетел</span>
                </span>
              </Tip>
            ))}
          </div>
        </div>
      ) : null}

      <Panel className="p-4 sm:p-6">
        <CampaignsTable rows={rows} win={win} day={dayValid ? day! : ''} owners={owners} ktRevenue={ktRevenue} admin={admin} updated={lastSync ? fmtWhen(lastSync) : null} />

        <p className="mt-4 text-[11px] leading-relaxed text-dim">
          Расход/клики/показы/лиды — из Facebook по объявлениям. Доход в сводке — подтверждённый
          из Keitaro (как в самом трекере). В строках доход привязан к объявлению по ad_id (Sub ID
          4); что не привязалось (конверсии без ad_id) видно в подписи «без привязки». Расход по
          кампаниям параллельно уходит в сам Keitaro.
        </p>
      </Panel>
    </div>
  );
}
