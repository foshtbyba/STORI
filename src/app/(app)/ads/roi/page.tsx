import { requireUser, scopeBuyerId } from '@/lib/auth';
import { canSeeTeam, type Role } from '@/lib/roles';
import { prisma } from '@/lib/db';
import { weekBounds, weekKey, weekLabel } from '@/lib/period';
import { usd, pct } from '@/lib/money';
import { Panel, PanelHead, Empty, Sub, Avatar } from '@/components/ui';
import { IconChart } from '@/components/icons';
import SyncAds from '@/components/SyncAds';

/**
 * Профит по потокам — расход из Facebook сведён с доходом из Keitaro.
 *
 * Расход по объявлениям (syncFacebookAds) привязан к кампании КТ по токену из
 * ссылки и лежит в KtCostDay. Доход по кампаниям — в KtCampaignDay. Здесь их
 * сводим по кампании и считаем прибыль и ROI за неделю — то, чего в самом КТ
 * не хватало: там был только доход.
 *
 * Расход в валюте кабинета: в ROI берём только доллары (агентские кабинеты
 * всегда USD), спенд в другой валюте помечаем — курс тут не считаем.
 */
type Camp = {
  campaignId: string;
  name: string;
  groupId: string;
  costCents: number;
  revenueCents: number;
  conversions: number;
  foreign: boolean;
  /** Есть ли расход и весь ли он уже залит в сам Keitaro. */
  hasCost: boolean;
  pushed: boolean;
};

export default async function RoiPage() {
  const user = await requireUser();
  const role = user.role as Role;
  const team = canSeeTeam(role);
  const admin = role === 'ADMIN';
  const scoped = scopeBuyerId(user);

  const key = weekKey(new Date());
  const { from, to } = weekBounds(key);

  const [costs, revs, groups] = await Promise.all([
    prisma.ktCostDay.findMany({ where: { date: { gte: from, lt: to } } }),
    prisma.ktCampaignDay.findMany({ where: { date: { gte: from, lt: to } } }),
    prisma.trackerGroup.findMany({
      include: { buyer: { select: { id: true, handle: true, initials: true, color: true, owner: true } } },
    }),
  ]);

  const buyerOfGroup = new Map(groups.map((g) => [g.externalId, g.buyer]));

  // Сводим по кампании: доход из KtCampaignDay, расход из KtCostDay.
  const byCampaign = new Map<string, Camp>();
  const ensure = (id: string): Camp => {
    let c = byCampaign.get(id);
    if (!c) {
      c = { campaignId: id, name: '', groupId: '', costCents: 0, revenueCents: 0, conversions: 0, foreign: false, hasCost: false, pushed: true };
      byCampaign.set(id, c);
    }
    return c;
  };

  for (const r of revs) {
    const c = ensure(r.campaignId);
    c.name = r.campaignName || c.name;
    c.groupId = r.groupId || c.groupId;
    c.revenueCents += r.revenueCents;
    c.conversions += r.conversions;
  }
  for (const k of costs) {
    if (!k.ktCampaignId) continue;
    const c = ensure(k.ktCampaignId);
    if (!c.name) c.name = k.ktCampaignName;
    // В ROI суммируем только долларовый расход; иную валюту курсом не сводим.
    if (k.currency === 'USD') {
      c.costCents += k.spendCents;
      c.hasCost = true;
      if (!k.pushedAt) c.pushed = false;
    } else {
      c.foreign = true;
    }
  }

  // Баер потока — через группу кампании. Кампания без известной группы видна
  // только команде (у баера её в своей выборке нет).
  type BuyerLite = { id: string; handle: string; initials: string; color: string; owner: boolean };
  const buyerOf = (groupId: string): BuyerLite | null => buyerOfGroup.get(groupId) ?? null;

  let camps = [...byCampaign.values()].filter((c) => c.costCents !== 0 || c.revenueCents !== 0);
  if (!team) camps = camps.filter((c) => buyerOf(c.groupId)?.id === scoped);

  // Группируем по баеру; кампании без баера — в отдельный «без привязки» (команде).
  type Bucket = { buyer: BuyerLite | null; rows: Camp[] };
  const buckets = new Map<string, Bucket>();
  for (const c of camps) {
    const b = buyerOf(c.groupId);
    const gkey = b?.id ?? '__none__';
    const bucket = buckets.get(gkey) ?? { buyer: b, rows: [] };
    bucket.rows.push(c);
    buckets.set(gkey, bucket);
  }
  for (const b of buckets.values()) {
    b.rows.sort((x, y) => (y.revenueCents - y.costCents) - (x.revenueCents - x.costCents));
  }
  // Баеры вперёд, «без привязки» и овнеры — в конец.
  const ordered = [...buckets.values()].sort((a, b) => {
    const rank = (x: Bucket) => (!x.buyer ? 2 : x.buyer.owner ? 1 : 0);
    return rank(a) - rank(b) || (a.buyer?.handle ?? '').localeCompare(b.buyer?.handle ?? '');
  });

  const totalCost = camps.reduce((s, c) => s + c.costCents, 0);
  const totalRev = camps.reduce((s, c) => s + c.revenueCents, 0);
  const totalProfit = totalRev - totalCost;

  // Объявления, у которых не распознан токен в ссылке — их расход в поток не
  // попал. Баеру считаем только его, админу/команде — все.
  const unmatched = await prisma.fbAd.count({
    where: { ktToken: '', ...(team ? {} : { adAccount: { adToken: { buyerId: scoped ?? '__none__' } } }) },
  });

  const lastCost = await prisma.ktCostDay.aggregate({ _max: { updatedAt: true } });
  const updated = lastCost._max.updatedAt;

  return (
    <div className="flex flex-col gap-3.5">
      <Panel className="p-4 sm:p-6">
        <PanelHead
          icon={<IconChart color="#b4c68c" />}
          tint="bg-sage-t"
          title="Профит по потокам"
          aside={<span className="text-[12.5px] text-mute">{weekLabel(key)}</span>}
          right={admin ? <SyncAds /> : undefined}
        />

        {/* Итог за неделю */}
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="расход ФБ" value={usd(totalCost)} />
          <Stat label="доход КТ" value={usd(totalRev)} />
          <Stat label="профит" value={usd(totalProfit)} tone={totalProfit >= 0 ? 'sage' : 'rust'} />
          <Stat label="ROI" value={totalCost > 0 ? pct(totalProfit, totalCost) : '—'} tone={totalProfit >= 0 ? 'sage' : 'rust'} />
        </div>

        {camps.length === 0 ? (
          <div className="mt-4">
            <Empty>
              Расхода по потокам пока нет. Он тянется отдельным заходом — запусти вручную кнопкой
              «Обновить расход» (у админа) или дождись крона.
            </Empty>
          </div>
        ) : (
          ordered.map((bucket, i) => {
            const bc = bucket.rows.reduce((s, c) => s + c.costCents, 0);
            const br = bucket.rows.reduce((s, c) => s + c.revenueCents, 0);
            const bp = br - bc;
            return (
              <div key={bucket.buyer?.id ?? `none-${i}`} className="mt-4 border-t border-line pt-4">
                <div className="flex flex-wrap items-center gap-2.5">
                  {bucket.buyer ? (
                    <Avatar initials={bucket.buyer.initials} color={bucket.buyer.color} size={30} />
                  ) : null}
                  <span className="text-[13.5px] font-semibold">
                    {bucket.buyer?.handle ?? 'Без привязки к баеру'}
                    {bucket.buyer?.owner ? <span className="ml-2 text-[11px] text-amber">овнер</span> : null}
                  </span>
                  <span className="n text-[11.5px] text-mute">
                    расход {usd(bc)} · доход {usd(br)} ·{' '}
                    <span className={bp >= 0 ? 'text-sage' : 'text-rust'}>профит {usd(bp)}</span>
                    {bc > 0 ? ` · ROI ${pct(bp, bc)}` : ''}
                  </span>
                </div>

                <div className="mt-2.5 flex flex-col gap-1.5">
                  {bucket.rows.map((c) => {
                    const profit = c.revenueCents - c.costCents;
                    return (
                      <Sub key={c.campaignId} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3.5 py-2.5">
                        <span className="min-w-0 flex-1 truncate text-[12.5px] text-soft" title={c.name}>
                          {c.name || `кампания ${c.campaignId}`}
                          {c.hasCost && c.pushed ? <span className="ml-2 text-[10px] text-sage" title="Расход залит в Keitaro">в КТ ✓</span> : null}
                          {c.foreign ? <span className="ml-2 text-[10px] text-rust" title="Был расход в валюте кабинета, отличной от USD — в ROI он не учтён">≠ USD</span> : null}
                        </span>
                        <span className="n w-16 shrink-0 text-right text-[11.5px] text-mute" title="конверсии">
                          {c.conversions || '—'}
                        </span>
                        <span className="n w-20 shrink-0 text-right text-[12px] text-mute" title="расход из ФБ">
                          {usd(c.costCents)}
                        </span>
                        <span className="n w-20 shrink-0 text-right text-[12px] text-mute" title="доход из КТ">
                          {usd(c.revenueCents)}
                        </span>
                        <span className={`n w-20 shrink-0 text-right text-[12.5px] font-semibold ${profit >= 0 ? 'text-sage' : 'text-rust'}`} title="профит">
                          {usd(profit)}
                        </span>
                        <span className={`n w-16 shrink-0 text-right text-[11.5px] ${profit >= 0 ? 'text-sage' : 'text-rust'}`} title="ROI">
                          {c.costCents > 0 ? pct(profit, c.costCents) : '—'}
                        </span>
                      </Sub>
                    );
                  })}
                </div>
              </div>
            );
          })
        )}

        <p className="mt-4 text-[11px] leading-relaxed text-dim">
          Расход берётся из ФБ по объявлениям и привязывается к кампании Keitaro по токену из ссылки
          (`track.top/qynyTnDK`), затем заливается в сам Keitaro (метка «в КТ ✓»), чтобы cost стоял
          рядом с доходом в отчётах трекера. Доход — подтверждённый, из КТ. Обновляется отдельным заходом
          {updated ? ` · последний расход ${new Intl.DateTimeFormat('ru-RU', { timeZone: process.env.SYNC_TZ || 'Europe/Moscow', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(updated)}` : ''}.
          {unmatched > 0 ? ` Объявлений без распознанного потока: ${unmatched} — проверь токен в ссылке.` : ''}
        </p>
      </Panel>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'sage' | 'rust' }) {
  return (
    <Sub className="px-3.5 py-3">
      <div className="text-[11px] text-mute">{label}</div>
      <div className={`n mt-1 text-[18px] font-semibold ${tone === 'sage' ? 'text-sage' : tone === 'rust' ? 'text-rust' : ''}`}>
        {value}
      </div>
    </Sub>
  );
}
