import { requireUser, scopeBuyerId } from '@/lib/auth';
import { canSeeTeam, type Role } from '@/lib/roles';
import { prisma } from '@/lib/db';
import { fmtWhen, weekBounds, weekKey } from '@/lib/period';
import { usd } from '@/lib/money';
import { accountBadge } from '@/lib/fb-status';
import { Panel, PanelHead, Empty } from '@/components/ui';
import { MyTokenForm, TokenForm } from '@/components/IntegrationForms';
import AccountGroup, { type Group } from '@/components/AccountGroup';
import BuyerGroup from '@/components/BuyerGroup';
import Reveal from '@/components/Reveal';
import { IconWallet } from '@/components/icons';

/**
 * Обзор рекламного пространства — техничка ФБ.
 *
 * Кабинеты сгруппированы по профилям (соцам) и сворачиваются. Овнеры (SKO,
 * MPR) вынесены в отдельный раздел под админом и не мешаются в командном
 * списке. Один и тот же act_ID под разными профилями метится «дублём», чтобы
 * назначить настоящий агентским, а лишние убрать из подсчёта.
 */
/**
 * «Остаток открута» кабинета. Авто-определение модели:
 *  • есть лимит (spend_cap>0) → остаток = лимит − потрачено (агентская модель);
 *  • иначе есть баланс (balance>0) → показываем баланс (предоплатная модель);
 *  • ничего из этого — бейдж не показываем.
 * Красным подсвечиваем, когда остаток < 200 в валюте кабинета.
 */
function remainOf(a: { currency: string; spendCapCents: number; amountSpentCents: number; balanceCents: number }):
  | { text: string; low: boolean }
  | undefined {
  let cents: number;
  if (a.spendCapCents > 0) cents = Math.max(0, a.spendCapCents - a.amountSpentCents);
  else if (a.balanceCents > 0) cents = a.balanceCents;
  else return undefined;
  const text = a.currency === 'USD' ? usd(cents) : `${Math.round(cents / 100).toLocaleString('ru-RU')} ${a.currency}`;
  return { text, low: cents / 100 < 200 };
}

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
    proxy: t.proxyUrl ?? '',
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
      remain: remainOf(a),
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

  // Командные кабинеты группируем по БАЕРУ: у баера бывает несколько профилей
  // (соцов), и удобнее раскрыть баера и увидеть его профили с их токенами, чем
  // листать плоский список. Баеров с проблемными токенами показываем выше.
  const teamByHandle = new Map<string, Group[]>();
  for (const t of teamTokens) {
    const arr = teamByHandle.get(t.buyer.handle) ?? [];
    arr.push(toGroup(t));
    teamByHandle.set(t.buyer.handle, arr);
  }
  const teamBuyers = [...teamByHandle.entries()]
    .map(([handle, groups]) => ({ handle, groups, dead: groups.filter((g) => g.error).length }))
    .sort((a, b) => b.dead - a.dead || a.handle.localeCompare(b.handle, 'ru'));

  return (
    <div className="flex flex-col gap-3.5">
      {/* Овнеры — сверху, отдельным блоком. Только под админом. Здесь же
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
            <Reveal title="Добавить овнерский кабинет">
              <p className="text-[11.5px] leading-relaxed text-mute">
                На овнера (SKO/MPR). Мультитокен из антидетекта целиком плюс прокси аккаунта, или
                System-User токен — тому прокси не нужен.
              </p>
              <TokenForm buyers={buyers} />
            </Reveal>
          </div>
        </Panel>
      ) : null}

      <Panel className="p-4 sm:p-6">
        <PanelHead
          icon={<IconWallet color="#b4c68c" />}
          tint="bg-sage-t"
          title="Подключённые кабинеты"
          aside={<span className="text-[12.5px] text-mute">{teamBuyers.length} баеров · {cabinets} кабинетов · {teamTokens.length} профилей</span>}
        />
        {teamTokens.length === 0 ? (
          <div className="mt-4">
            <Empty>Кабинеты ещё не подключены — добавь первый ниже.</Empty>
          </div>
        ) : (
          teamBuyers.map((b) => <BuyerGroup key={b.handle} groups={b.groups} />)
        )}
        <p className="mt-4 text-[11px] leading-relaxed text-dim">
          Цифра рядом с кабинетом — расход из ФБ за текущую неделю, для справки. В зарплату идёт
          расход с Brocard.
        </p>

        {admin ? (
          <p className="mt-5 border-t border-line pt-4 text-[11.5px] leading-relaxed text-mute">
            Командные кабинеты баеры подключают у себя сами. Овнерские — в разделе выше.
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
    </div>
  );
}
