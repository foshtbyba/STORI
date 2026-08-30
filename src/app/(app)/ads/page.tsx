import { requireUser, scopeBuyerId } from '@/lib/auth';
import { canSeeTeam, type Role } from '@/lib/roles';
import { prisma } from '@/lib/db';
import { fmtDay, weekBounds, weekKey } from '@/lib/period';
import { usd } from '@/lib/money';
import { Panel, PanelHead, Sub, Empty, Avatar } from '@/components/ui';
import { IconRocket, IconWallet, IconTag, IconChart } from '@/components/icons';

/**
 * Обзор рекламного пространства — техничка ФБ.
 *
 * Пока здесь витрина того, что уже подключено: токены и кабинеты по баерам и
 * справочный расход из ФБ за неделю. Управление кампаниями и автозалив живут
 * на соседних вкладках и подключаются следующими шагами.
 */
export default async function AdsOverviewPage() {
  const user = await requireUser();
  const team = canSeeTeam(user.role as Role);
  const scoped = scopeBuyerId(user);

  const tokens = await prisma.adToken.findMany({
    where: team ? {} : { buyerId: scoped ?? '__none__' },
    include: {
      buyer: { select: { handle: true, initials: true, color: true } },
      accounts: { orderBy: { name: 'asc' } },
    },
    orderBy: { createdAt: 'asc' },
  });

  // Справочный расход за текущую неделю по кабинетам.
  const { from, to } = weekBounds(weekKey(new Date()));
  const spend = await prisma.adAccountDay.groupBy({
    by: ['accountId'],
    where: { date: { gte: from, lt: to } },
    _sum: { spendCents: true },
  });
  const spendByAccount = new Map(spend.map((s) => [s.accountId, s._sum.spendCents ?? 0]));

  const cabinets = tokens.reduce((n, t) => n + t.accounts.length, 0);

  return (
    <div className="flex flex-col gap-3.5">
      <Panel className="p-4 sm:p-6">
        <PanelHead
          icon={<IconRocket color="#b4c68c" />}
          tint="bg-sage-t"
          title="Реклама"
          aside={<span className="text-[12.5px] text-mute">техничка Facebook</span>}
        />
        <p className="mt-4 text-[12px] leading-relaxed text-mute">
          Здесь всё про рекламу: подключённые кабинеты, а дальше — мониторинг кампаний (лиды, клики,
          CTR), включение и выключение объявлений и автозалив. Расход отсюда справочный — реальный
          считается по Brocard в «Статистике».
        </p>
      </Panel>

      <Panel className="p-4 sm:p-6">
        <PanelHead
          icon={<IconWallet color="#b4c68c" />}
          tint="bg-sage-t"
          title="Подключённые кабинеты"
          aside={<span className="text-[12.5px] text-mute">{cabinets} кабинетов</span>}
        />
        {tokens.length === 0 ? (
          <Empty>
            {team
              ? 'Токенов пока нет — добавь их в «Статистика → Источники».'
              : 'Твои кабинеты ещё не подключены — попроси админа или добавь токен, когда откроем это баерам.'}
          </Empty>
        ) : (
          tokens.map((token) => (
            <div key={token.id} className="mt-4 border-t border-line pt-4">
              <div className="flex items-center gap-3">
                <Avatar initials={token.buyer.initials} color={token.buyer.color} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[14.5px] font-semibold">
                    {token.buyer.handle}
                    <span className="ml-2 text-[12px] font-normal text-mute">{token.label}</span>
                  </span>
                  <span className="block text-[11.5px] text-mute">
                    {token.lastSyncAt ? `обновлено ${fmtDay(token.lastSyncAt)}` : 'ещё не синхронизировано'}
                    {' · '}
                    {token.enabled ? 'включён' : 'выключен'}
                  </span>
                </span>
              </div>
              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {token.accounts.map((acc) => (
                  <Sub key={acc.id} className="flex items-center justify-between px-3.5 py-2.5">
                    <span className="min-w-0 truncate text-[12.5px] text-soft" title={acc.externalId}>
                      {acc.name || acc.externalId}
                    </span>
                    <span className="n ml-2 shrink-0 text-[12.5px] text-mute">
                      {usd(spendByAccount.get(acc.id) ?? 0)}
                    </span>
                  </Sub>
                ))}
                {token.accounts.length === 0 ? (
                  <span className="text-[12px] text-mute">кабинетов под токеном не видно</span>
                ) : null}
              </div>
            </div>
          ))
        )}
        <p className="mt-4 text-[11px] leading-relaxed text-dim">
          Цифра рядом с кабинетом — расход из ФБ за текущую неделю, для справки. В зарплату идёт
          расход с Brocard.
        </p>
      </Panel>

      <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-2 lg:gap-3.5">
        <Panel className="p-4 sm:p-6">
          <PanelHead icon={<IconChart color="#b4c68c" />} tint="bg-sage-t" title="Кампании" />
          <p className="mt-3 text-[12px] leading-relaxed text-mute">
            Таблица кампаний с метриками — лиды, клики, CTR, расход — и кнопками пауза/запуск. На
            подключении.
          </p>
        </Panel>
        <Panel className="p-4 sm:p-6">
          <PanelHead icon={<IconTag color="#b4c68c" />} tint="bg-sage-t" title="Автозалив" />
          <p className="mt-3 text-[12px] leading-relaxed text-mute">
            Заливка кампаний по шаблонам из карточек офферов. Следующий большой шаг после мониторинга.
          </p>
        </Panel>
      </div>
    </div>
  );
}
