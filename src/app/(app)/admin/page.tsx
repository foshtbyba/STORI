import { requireUser } from '@/lib/auth';
import { type Role } from '@/lib/roles';
import { prisma } from '@/lib/db';
import { currentPeriodKey, teamSummary, firstToCross } from '@/lib/queries';
import { periodTitle, isWeekKey, shiftKey, fmtDay } from '@/lib/period';
import PeriodNav from '@/components/PeriodNav';
import { Panel, PanelHead, Sub, Empty } from '@/components/ui';
import BuyerRoster, { type RosterRow } from '@/components/BuyerRoster';
import AddMember from '@/components/AddMember';
import BonusPanel, { type BonusRow } from '@/components/BonusPanel';
import LadderEditor, { type LadderRule } from '@/components/LadderEditor';
import BuyerLadder, { type BuyerLadderRow } from '@/components/BuyerLadder';
import CollapsiblePanel from '@/components/CollapsiblePanel';
import { parseTiers } from '@/lib/salary';
import { SYNC_DAYS } from '@/lib/sync';
import { BUILD_INFO } from '@/lib/build-info';
import { BROCARD_OVERHEAD } from '@/lib/brocard-const';
import { linkGroup, linkBrocardTeam } from '@/app/actions/integrations';
import { TrackerForm, BrocardForm, SyncNow } from '@/components/IntegrationForms';
import BrocardAccounts from '@/components/BrocardAccounts';
import { IconUsers, IconChart, IconWallet, IconLink, IconWarn } from '@/components/icons';

/** tiersJson → строки для ввода (доллары/проценты). */
function toLadderRule(id: string, name: string, tiersJson: string, fixedRub: number): LadderRule {
  return {
    id,
    name,
    fixedRub: String(fixedRub),
    tiers: parseTiers(tiersJson).map((t) => ({
      fromDollars: String(t.fromCents / 100),
      ratePct: String(t.ratePct),
    })),
  };
}

/**
 * Админ-настройки — отдельное окно за надписью ADMIN в шапке. Здесь редкие
 * вещи, которым не место в основных отчётах: ростер команды (дата выхода, день
 * рождения, позиция), разовые бонусы и ключи к источникам цифр.
 *
 * Ключи от Brocard и Keitaro живут тут, а не на своей вкладке: настраивают их
 * раз в жизни, а доступ под ними — к деньгам и трекеру всей команды. Кабинеты
 * Facebook, наоборот, уехали в «Рекламу» — там их каждый день и смотрят.
 */
export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ p?: string }>;
}) {
  const user = await requireUser();
  if ((user.role as Role) !== 'ADMIN') {
    return <Empty>Настройки доступны только админу.</Empty>;
  }

  const now = await currentPeriodKey();
  const { p } = await searchParams;
  const key = p && isWeekKey(p) ? p : now;

  const summary = await teamSummary(key);
  const rate = summary.period.rubPerUsd;
  const closed = summary.period.status === 'CLOSED';

  const BONUS_THRESHOLD = 500_000;
  const [firstHit, bonusRows] = await Promise.all([
    firstToCross(key, BONUS_THRESHOLD),
    prisma.bonus.findMany({
      where: { periodKey: key },
      include: { buyer: true },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  // Источники цифр: ключи, привязки групп и команд.
  const [tracker, groups, brocard, brocardTeams, linkBuyers] = await Promise.all([
    prisma.tracker.findFirst(),
    prisma.trackerGroup.findMany({
      include: { buyer: { select: { handle: true } } },
      orderBy: { name: 'asc' },
    }),
    prisma.brocardConfig.findFirst(),
    prisma.brocardTeam.findMany({ orderBy: { name: 'asc' } }),
    prisma.buyer.findMany({
      where: { archived: false },
      select: { id: true, handle: true },
      orderBy: { handle: 'asc' },
    }),
  ]);
  const unlinkedGroups = groups.filter((g) => !g.buyerId).length;
  // Общак — не «непривязанная»: она назначена расходниками осознанно.
  const unlinkedTeams = brocardTeams.filter((t) => !t.buyerId && !t.overhead).length;

  const rosterRows: RosterRow[] = (
    await prisma.buyer.findMany({
      // Активные + уволенные (архив с датой ухода), чтобы уволенного можно было
      // вернуть. Служебно-архивных без даты ухода в ростер не тянем.
      where: { OR: [{ archived: false }, { endedAt: { not: null } }] },
      orderBy: [{ owner: 'asc' }, { handle: 'asc' }],
      select: {
        id: true, handle: true, initials: true, color: true,
        startedAt: true, endedAt: true, birthday: true, position: true, owner: true,
        user: { select: { active: true } },
      },
    })
  ).map((b) => ({
    id: b.id,
    handle: b.handle,
    initials: b.initials,
    color: b.color,
    startedAt: b.startedAt ? b.startedAt.toISOString().slice(0, 10) : '',
    birthday: b.birthday ? b.birthday.toISOString().slice(0, 10) : '',
    position: b.position ?? '',
    owner: b.owner,
    blocked: !b.user.active,
    fired: !!b.endedAt,
    endedAt: b.endedAt ? b.endedAt.toISOString().slice(0, 10) : '',
  }));

  // Лесенка по умолчанию — базовая, на неё завязаны все, у кого нет своей.
  const baseRule = await prisma.salaryRule.findFirst();
  const defaultRule = baseRule
    ? toLadderRule(baseRule.id, baseRule.name, baseRule.tiersJson, baseRule.fixedRub)
    : null;

  // Лесенка под каждого баера. Овнеров тут нет — они в зарплате не участвуют.
  const ladderBuyers = await prisma.buyer.findMany({
    where: { archived: false, owner: false },
    include: { salaryRule: true },
    orderBy: { handle: 'asc' },
  });
  const buyerLadders: BuyerLadderRow[] = ladderBuyers.map((b) => {
    const tiersJson = b.salaryRule?.tiersJson ?? '';
    const fixedRub = b.salaryRule?.fixedRub ?? 10_000;
    return {
      buyerId: b.id,
      handle: b.handle,
      initials: b.initials,
      color: b.color,
      custom: !!b.salaryRuleId && b.salaryRuleId !== baseRule?.id,
      rule: toLadderRule(b.salaryRuleId ?? b.id, b.handle, tiersJson, fixedRub),
    };
  });

  return (
    <div className="flex flex-col gap-3.5">
      <Panel className="p-4 sm:p-6">
        <PanelHead
          icon={<IconUsers color="#b4c68c" />}
          tint="bg-sage-t"
          title="Команда"
          aside={<span className="hidden text-[12.5px] text-mute sm:inline">настройки</span>}
          right={<span className="text-[12.5px] text-mute">дата выхода, профиль, овнеры</span>}
        />
        <BuyerRoster rows={rosterRows} />
        <AddMember />
      </Panel>

      {/* ── Источники цифр ────────────────────────────────────────────── */}
      <Panel className="p-4 sm:p-6">
        <PanelHead
          icon={<IconLink color="#b4c68c" />}
          tint="bg-sage-t"
          title="Источники цифр"
          aside={
            <span className="hidden text-[12.5px] text-mute sm:inline">
              каждые полчаса — сегодня, раз в сутки — все {SYNC_DAYS} дней
              <span className="ml-2 rounded-full bg-sub px-2 py-0.5 text-[10.5px] text-dim" title="Какая сборка сейчас развёрнута">
                сборка {BUILD_INFO}
              </span>
            </span>
          }
          right={<SyncNow />}
        />
        <p className="mt-4 text-[12px] leading-relaxed text-mute">
          Доход приходит из Keitaro и ложится в отчёты дня. Реальный расход — с Brocard
          (фактические списания с карт); Facebook тянется отдельно и только для справки, в
          зарплату он не идёт. Синхронизация никогда не спорит с человеком: поправленную руками
          цифру в отчёте она не трогает и отмечает такую строку отдельно. Кабинеты Facebook
          подключаются в окне «Реклама».
        </p>
      </Panel>

      {/* ── Brocard ───────────────────────────────────────────────────── */}
      <CollapsiblePanel
        icon={<IconWallet color="#b4c68c" />}
        tint="bg-sage-t"
        title="Brocard"
        aside={<span className="text-[12.5px] text-mute">реальный расход</span>}
        summary={brocard?.lastSyncAt ? <span className="text-[12.5px] text-mute">последний заход {fmtDay(brocard.lastSyncAt)}</span> : undefined}
      >
        {brocard?.lastError ? (
          <Sub className="mt-3 px-3.5 py-2.5 text-[12px] leading-relaxed text-rust">
            {brocard.lastError}
          </Sub>
        ) : null}

        <p className="mt-3 text-[11.5px] leading-relaxed text-mute">
          Ключ берётся в кабинете Brocard: раздел <span className="text-soft">Автоматизация → API</span>,
          сначала «Включить», затем «Создать». Расход отсюда — фактические списания с карт, он и идёт
          в отчёты и зарплату. Отклонённые и центовые проверки карты в расход не считаем.
        </p>
        <BrocardForm hasKey={Boolean(brocard?.apiKey)} />
        {brocard?.apiKey ? <BrocardAccounts /> : null}

        <div className="mt-5 border-t border-line pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[12.5px] font-semibold">Команды Brocard</span>
            {unlinkedTeams ? (
              <span className="flex items-center gap-2 text-[12px] text-rust">
                <IconWarn color="#ce6e58" size={14} />
                без баера: {unlinkedTeams}
              </span>
            ) : null}
          </div>
          <p className="mt-1.5 text-[11.5px] leading-relaxed text-mute">
            Расход делится по командам: команда — это баер. Пока команда не привязана, её траты
            никуда не пишутся и показываются отдельной строкой в отчёте о синхронизации.
          </p>

          {brocardTeams.length === 0 ? (
            <Empty>Команд пока не видно — сохрани ключ выше, и они подтянутся.</Empty>
          ) : (
            <div className="mt-3 flex flex-col gap-2">
              {brocardTeams.map((t) => (
                <form
                  key={t.id}
                  action={linkBrocardTeam}
                  className="flex flex-wrap items-center gap-2.5 rounded-[16px] bg-sub px-3.5 py-2.5"
                >
                  <input type="hidden" name="id" value={t.id} />
                  <span className="min-w-0 flex-1 truncate text-[13px]">
                    {t.name}
                    <span className="ml-2 text-[11px] text-dim">#{t.externalId}</span>
                    {t.overhead ? (
                      <span className="ml-2 rounded-full bg-rust-t px-2 py-0.5 text-[10px] text-rust">
                        расходники
                      </span>
                    ) : null}
                  </span>
                  <select
                    name="buyerId"
                    defaultValue={t.overhead ? BROCARD_OVERHEAD : (t.buyerId ?? '')}
                    className="h-9 rounded-xl border border-line2 bg-panel px-3 text-[12.5px] text-text outline-none focus:border-sage"
                  >
                    <option value="">— не привязана —</option>
                    <option value={BROCARD_OVERHEAD}>Расходники на команду</option>
                    {linkBuyers.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.handle}
                      </option>
                    ))}
                  </select>
                  <button
                    type="submit"
                    className="rounded-full border border-line2 px-3.5 py-1.5 text-[12px] text-soft transition hover:border-sage hover:text-sage"
                  >
                    Сохранить
                  </button>
                </form>
              ))}
            </div>
          )}
        </div>
      </CollapsiblePanel>

      {/* ── Keitaro ───────────────────────────────────────────────────── */}
      <CollapsiblePanel
        icon={<IconChart color="#b4c68c" />}
        tint="bg-sage-t"
        title="Keitaro"
        aside={<span className="text-[12.5px] text-mute">доход</span>}
        summary={tracker?.lastSyncAt ? <span className="text-[12.5px] text-mute">последний заход {fmtDay(tracker.lastSyncAt)}</span> : undefined}
      >
        {tracker?.lastError ? (
          <Sub className="mt-3 px-3.5 py-2.5 text-[12px] leading-relaxed text-rust">
            {tracker.lastError}
          </Sub>
        ) : null}

        <TrackerForm baseUrl={tracker?.baseUrl ?? ''} hasKey={Boolean(tracker?.apiKey)} />

        <div className="mt-5 border-t border-line pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[12.5px] font-semibold">Группы кампаний</span>
            {unlinkedGroups ? (
              <span className="flex items-center gap-2 text-[12px] text-rust">
                <IconWarn color="#ce6e58" size={14} />
                без баера: {unlinkedGroups}
              </span>
            ) : null}
          </div>
          <p className="mt-1.5 text-[11.5px] leading-relaxed text-mute">
            Доход делится по группам: группа — это баер. Пока группа не привязана, её доход никуда
            не записывается и показывается отдельной строкой в отчёте о синхронизации — молча
            терять деньги нельзя.
          </p>

          {groups.length === 0 ? (
            <Empty>Групп пока не видно — сохрани ключ выше, и они подтянутся.</Empty>
          ) : (
            <div className="mt-3 flex flex-col gap-2">
              {groups.map((g) => (
                <form
                  key={g.id}
                  action={linkGroup}
                  className="flex flex-wrap items-center gap-2.5 rounded-[16px] bg-sub px-3.5 py-2.5"
                >
                  <input type="hidden" name="id" value={g.id} />
                  <span className="min-w-0 flex-1 truncate text-[13px]">
                    {g.name}
                    <span className="ml-2 text-[11px] text-dim">#{g.externalId}</span>
                  </span>
                  <select
                    name="buyerId"
                    defaultValue={g.buyerId ?? ''}
                    className="h-9 rounded-xl border border-line2 bg-panel px-3 text-[12.5px] text-text outline-none focus:border-sage"
                  >
                    <option value="">— не привязана —</option>
                    {linkBuyers.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.handle}
                      </option>
                    ))}
                  </select>
                  <button
                    type="submit"
                    className="rounded-full border border-line2 px-3.5 py-1.5 text-[12px] text-soft transition hover:border-sage hover:text-sage"
                  >
                    Сохранить
                  </button>
                </form>
              ))}
            </div>
          )}
        </div>
      </CollapsiblePanel>

      {buyerLadders.length > 0 ? (
        <CollapsiblePanel
          icon={<IconChart color="#b4c68c" />}
          tint="bg-sage-t"
          title="Лесенки по баерам"
          summary={<span className="text-[12.5px] text-mute">своя лесенка у каждого</span>}
        >
          <div className="flex flex-col">
            {buyerLadders.map((b) => (
              <BuyerLadder key={b.buyerId} row={b} />
            ))}
          </div>
        </CollapsiblePanel>
      ) : null}

      {defaultRule ? (
        <CollapsiblePanel
          icon={<IconChart color="#b4c68c" />}
          tint="bg-sage-t"
          title="Лесенка по умолчанию"
          summary={<span className="text-[12.5px] text-mute">для всех, у кого нет своей</span>}
        >
          <LadderEditor rule={defaultRule} />
        </CollapsiblePanel>
      ) : null}

      <CollapsiblePanel
        icon={<IconWallet color="#b4c68c" />}
        tint="bg-sage-t"
        title="Разовые бонусы"
        aside={<span className="text-[12.5px] text-mute">{periodTitle(key)}</span>}
      >
        <div className="mb-3 flex justify-end">
          <PeriodNav
            base="/admin"
            label={periodTitle(key)}
            isWeek
            weeksOnly
            prev={shiftKey(key, -1)}
            next={shiftKey(key, 1)}
            week={key}
            month={key}
          />
        </div>
        <BonusPanel
          bare
          periodKey={key}
          rate={rate}
          closed={closed}
          threshold={BONUS_THRESHOLD}
          buyers={summary.buyers.map((r) => ({ id: r.buyer.id, handle: r.buyer.handle }))}
          firstHit={
            firstHit
              ? {
                  handle: firstHit.buyer.handle,
                  day: fmtDay(firstHit.date),
                  awarded: bonusRows.some(
                    (b) => b.buyerId === firstHit.buyer.id && b.note.startsWith('первые'),
                  ),
                }
              : null
          }
          bonuses={bonusRows.map(
            (b): BonusRow => ({
              id: b.id,
              buyer: { initials: b.buyer.initials, color: b.buyer.color, handle: b.buyer.handle },
              amountCents: b.amountCents,
              note: b.note,
              day: fmtDay(b.createdAt),
            }),
          )}
        />
      </CollapsiblePanel>
    </div>
  );
}
