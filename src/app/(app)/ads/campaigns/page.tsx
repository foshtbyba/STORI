import { requireUser, scopeBuyerId } from '@/lib/auth';
import { canSeeTeam, type Role } from '@/lib/roles';
import { prisma } from '@/lib/db';
import { fmtWhen } from '@/lib/period';
import { campaignBadge, type StatusTone } from '@/lib/fb-status';
import { Panel, PanelHead, Empty, Sub, Avatar } from '@/components/ui';
import { IconRocket } from '@/components/icons';

/**
 * Кампании — что заведено в кабинетах и что реально запущено.
 *
 * Данные тянет глубокий заход синхронизации (раз в сутки) и кладёт в FbCampaign.
 * Здесь только показываем: сгруппировано по баеру и кабинету, статус — цветом,
 * запущенные сверху. Метрики (лиды, клики, CTR, расход) и пауза/запуск —
 * следующий шаг.
 */
const TONE: Record<StatusTone, string> = {
  ok: 'bg-sage-t text-sage',
  warn: 'bg-amber-t text-amber',
  bad: 'bg-rust-t text-rust',
  mute: 'bg-sub text-mute',
};

function fmtBudget(cents: number | null, currency: string) {
  if (cents == null) return '—';
  const v = Math.round(cents / 100);
  return `${v.toLocaleString('ru-RU')} ${currency === 'USD' ? '$' : currency}/день`;
}

export default async function CampaignsPage() {
  const user = await requireUser();
  const team = canSeeTeam(user.role as Role);
  const scoped = scopeBuyerId(user);

  // Кампании через кабинет → токен → баер. Баер видит только свои.
  const campaigns = await prisma.fbCampaign.findMany({
    where: team ? {} : { adAccount: { adToken: { buyerId: scoped ?? '__none__' } } },
    include: {
      adAccount: {
        select: {
          name: true,
          externalId: true,
          currency: true,
          adToken: { select: { lastSyncAt: true, buyer: { select: { handle: true, initials: true, color: true, owner: true } } } },
        },
      },
    },
  });

  // Запущенные вперёд, дальше по имени.
  const rank = (s: string) => (s === 'ACTIVE' ? 0 : s.includes('PAUSED') ? 1 : 2);
  campaigns.sort((a, b) => rank(a.status) - rank(b.status) || a.name.localeCompare(b.name));

  const active = campaigns.filter((c) => c.status === 'ACTIVE').length;
  const lastSync = campaigns.reduce<Date | null>((m, c) => {
    const t = c.adAccount.adToken.lastSyncAt;
    return t && (!m || t > m) ? t : m;
  }, null);

  // Группируем по баеру, внутри — по кабинету.
  type Row = (typeof campaigns)[number];
  const byBuyer = new Map<string, { initials: string; color: string; owner: boolean; rows: Row[] }>();
  for (const c of campaigns) {
    const b = c.adAccount.adToken.buyer;
    const g = byBuyer.get(b.handle) ?? { initials: b.initials, color: b.color, owner: b.owner, rows: [] };
    g.rows.push(c);
    byBuyer.set(b.handle, g);
  }

  return (
    <div className="flex flex-col gap-3.5">
      <Panel className="p-4 sm:p-6">
        <PanelHead
          icon={<IconRocket color="#b4c68c" />}
          tint="bg-sage-t"
          title="Кампании"
          aside={
            <span className="text-[12.5px] text-mute">
              запущено {active} из {campaigns.length}
              {lastSync ? ` · обновлено ${fmtWhen(lastSync)}` : ''}
            </span>
          }
        />

        {campaigns.length === 0 ? (
          <div className="mt-4">
            <Empty>
              Кампаний пока не видно. Они подтягиваются раз в сутки глубоким заходом синхронизации —
              или запусти вручную в ADMIN → «Синхронизировать сейчас».
            </Empty>
          </div>
        ) : (
          [...byBuyer.entries()].map(([handle, g]) => (
            <div key={handle} className="mt-4 border-t border-line pt-4">
              <div className="flex items-center gap-2.5">
                <Avatar initials={g.initials} color={g.color} size={30} />
                <span className="text-[13.5px] font-semibold">
                  {handle}
                  {g.owner ? <span className="ml-2 text-[11px] text-amber">овнер</span> : null}
                </span>
                <span className="text-[11.5px] text-mute">
                  · запущено {g.rows.filter((r) => r.status === 'ACTIVE').length} из {g.rows.length}
                </span>
              </div>

              <div className="mt-2.5 flex flex-col gap-1.5">
                {g.rows.map((c) => {
                  const badge = campaignBadge(c.status);
                  return (
                    <Sub key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3.5 py-2.5">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] ${TONE[badge.tone]}`}>{badge.label}</span>
                      <span className="min-w-0 flex-1 truncate text-[12.5px] text-soft" title={c.name}>
                        {c.name || '(без названия)'}
                      </span>
                      <span className="n text-[11.5px] text-mute">
                        {fmtBudget(c.dailyBudget, c.adAccount.currency)}
                      </span>
                      <span className="n text-[10.5px] text-dim" title={c.adAccount.externalId}>
                        {c.adAccount.name || c.adAccount.externalId.replace(/^act_/, '')}
                      </span>
                    </Sub>
                  );
                })}
              </div>
            </div>
          ))
        )}

        <p className="mt-4 text-[11px] leading-relaxed text-dim">
          Пока это витрина: видно, что запущено, на паузе или отклонено. Метрики (лиды, клики, CTR,
          расход) и кнопки пауза/запуск — следующий шаг.
        </p>
      </Panel>
    </div>
  );
}
