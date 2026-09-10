import { requireUser, scopeBuyerId } from '@/lib/auth';
import { canSeeTeam, type Role } from '@/lib/roles';
import { prisma } from '@/lib/db';
import { fmtWhen, weekBounds, weekKey } from '@/lib/period';
import { usd } from '@/lib/money';
import { accountBadge } from '@/lib/fb-status';
import { Panel, PanelHead, Empty } from '@/components/ui';
import { MyTokenForm, TokenForm } from '@/components/IntegrationForms';
import AccountGroup, { type Group } from '@/components/AccountGroup';
import { IconWallet, IconTag, IconChart } from '@/components/icons';

/**
 * Обзор рекламного пространства — техничка ФБ.
 *
 * Кабинеты сгруппированы по профилям (соцам) и сворачиваются. Овнеры (SKO,
 * MPR) вынесены в отдельный раздел под админом и не мешаются в командном
 * списке. Один и тот же act_ID под разными профилями метится «дублём», чтобы
 * назначить настоящий агентским, а лишние убрать из подсчёта.
 */
export default async function AdsOverviewPage() {
  const user = await requireUser();
  const role = user.role as Role;
  const team = canSeeTeam(role);
  const admin = role === 'ADMIN';
  const scoped = scopeBuyerId(user);

  const [tokens, buyers] = await Promise.all([
    prisma.adToken.findMany({
      where: team ? {} : { buyerId: scoped ?? '__none__' },
      include: {
        buyer: { select: { id: true, handle: true, initials: true, color: true, owner: true } },
        accounts: { orderBy: { name: 'asc' } },
      },
      orderBy: { createdAt: 'asc' },
    }),
    admin
      ? prisma.buyer.findMany({
          // Админ заводит только овнерские кабинеты (SKO/MPR). Обычные баеры
          // подключают свои сами — им незачем светиться в этом списке.
          where: { archived: false, owner: true },
          select: { id: true, handle: true },
          orderBy: { handle: 'asc' },
        })
      : Promise.resolve([]),
  ]);

  // Справочный расход за текущую неделю по кабинетам.
  const { from, to } = weekBounds(weekKey(new Date()));
  const spend = await prisma.adAccountDay.groupBy({
    by: ['accountId'],
    where: { date: { gte: from, lt: to } },
    _sum: { spendCents: true },
  });
  const spendByAccount = new Map(spend.map((s) => [s.accountId, s._sum.spendCents ?? 0]));

  // Дубли: один act_ID виден под несколькими профилями. Считаем, сколько раз
  // встречается каждый externalId по всем видимым токенам.
  const seen = new Map<string, number>();
  for (const t of tokens) for (const a of t.accounts) seen.set(a.externalId, (seen.get(a.externalId) ?? 0) + 1);

  const now = new Date();
  const toGroup = (t: (typeof tokens)[number]): Group => ({
    tokenId: t.id,
    handle: t.buyer.handle,
    initials: t.buyer.initials,
    color: t.buyer.color,
    label: t.label,
    proxied: Boolean(t.proxyUrl),
    paused: Boolean(t.pausedUntil && t.pausedUntil > now),
    error: t.lastError ?? '',
    updated: t.lastSyncAt ? fmtWhen(t.lastSyncAt) : null,
    admin,
    own: Boolean(user.buyer && t.buyerId === user.buyer.id),
    accounts: t.accounts.map((a) => ({
      id: a.id,
      externalId: a.externalId,
      name: a.name,
      currency: a.currency,
      enabled: a.enabled,
      agency: a.agency,
      duplicate: (seen.get(a.externalId) ?? 0) > 1,
      spend:
        a.currency === 'USD'
          ? usd(spendByAccount.get(a.id) ?? 0)
          : Math.round((spendByAccount.get(a.id) ?? 0) / 100).toLocaleString('ru-RU'),
      badge: accountBadge(a.accountStatus, a.disableReason),
    })),
  });

  // Овнеров (SKO/MPR) в командный список не пускаем — они у админа отдельно.
  const teamTokens = tokens.filter((t) => !t.buyer.owner);
  const ownerTokens = admin ? tokens.filter((t) => t.buyer.owner) : [];
  const cabinets = teamTokens.reduce((n, t) => n + t.accounts.length, 0);

  // Овнеров группируем по владельцу (их двое — SKO и MPR): у каждого свой блок.
  const ownersByHandle = new Map<string, typeof ownerTokens>();
  for (const t of ownerTokens) {
    const arr = ownersByHandle.get(t.buyer.handle) ?? [];
    arr.push(t);
    ownersByHandle.set(t.buyer.handle, arr);
  }

  return (
    <div className="flex flex-col gap-3.5">
      <Panel className="p-4 sm:p-6">
        <PanelHead
          icon={<IconWallet color="#b4c68c" />}
          tint="bg-sage-t"
          title="Подключённые кабинеты"
          aside={<span className="text-[12.5px] text-mute">{cabinets} кабинетов · {teamTokens.length} профилей</span>}
        />
        {teamTokens.length === 0 ? (
          <div className="mt-4">
            <Empty>Кабинеты ещё не подключены — добавь первый ниже.</Empty>
          </div>
        ) : (
          teamTokens.map((t) => <AccountGroup key={t.id} group={toGroup(t)} defaultOpen={false} />)
        )}
        <p className="mt-4 text-[11px] leading-relaxed text-dim">
          Цифра рядом с кабинетом — расход из ФБ за текущую неделю, для справки. В зарплату идёт
          расход с Brocard.
        </p>

        {admin ? (
          <p className="mt-5 border-t border-line pt-4 text-[11.5px] leading-relaxed text-mute">
            Командные кабинеты баеры подключают у себя сами. Овнерские — в разделе ниже.
          </p>
        ) : user.buyer ? (
          <div className="mt-5 border-t border-line pt-4">
            <div className="text-[12.5px] font-semibold">Подключить свой кабинет</div>
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-mute">
              Мультитокен из антидетекта и прокси аккаунта. Всё, что видно под ним, — твои
              кабинеты.
            </p>
            <MyTokenForm />
          </div>
        ) : (
          <p className="mt-5 border-t border-line pt-4 text-[11.5px] text-mute">
            У аккаунта нет профиля баера — подключать кабинеты не с чем.
          </p>
        )}
      </Panel>

      {/* Овнеры — отдельно, у каждого свой блок. Только под админом. Здесь же
          админ и добавляет овнерские кабинеты — обычные баеры подключают свои
          у себя. */}
      {admin ? (
        <Panel className="p-4 sm:p-6">
          <PanelHead
            icon={<IconWallet color="#d2a06a" />}
            tint="bg-amber-t"
            title="Аккаунты овнеров"
            aside={<span className="text-[12.5px] text-mute">отдельный лист, вне командной статистики</span>}
          />
          {ownerTokens.length === 0 ? (
            <div className="mt-4">
              <Empty>Овнерских кабинетов пока нет — добавь ниже.</Empty>
            </div>
          ) : (
            [...ownersByHandle.entries()].map(([handle, list]) => (
              <div key={handle} className="mt-4">
                <div className="text-[12.5px] font-semibold text-amber">{handle}</div>
                {list.map((t) => <AccountGroup key={t.id} group={toGroup(t)} />)}
              </div>
            ))
          )}

          <div className="mt-5 border-t border-line pt-4">
            <div className="text-[12.5px] font-semibold">Добавить овнерский кабинет</div>
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-mute">
              На овнера (SKO/MPR). Мультитокен из антидетекта целиком плюс прокси аккаунта, или
              System-User токен — тому прокси не нужен.
            </p>
            <TokenForm buyers={buyers} />
          </div>
        </Panel>
      ) : null}

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
