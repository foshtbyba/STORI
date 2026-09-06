import { requireUser } from '@/lib/auth';
import { type Role } from '@/lib/roles';
import { prisma } from '@/lib/db';
import { currentPeriodKey, teamSummary, firstToCross } from '@/lib/queries';
import { periodTitle, isWeekKey, shiftKey, fmtDay } from '@/lib/period';
import PeriodNav from '@/components/PeriodNav';
import { Panel, PanelHead, Empty } from '@/components/ui';
import BuyerRoster, { type RosterRow } from '@/components/BuyerRoster';
import AddMember from '@/components/AddMember';
import BonusPanel, { type BonusRow } from '@/components/BonusPanel';
import LadderEditor, { type LadderRule } from '@/components/LadderEditor';
import BuyerLadder, { type BuyerLadderRow } from '@/components/BuyerLadder';
import CollapsiblePanel from '@/components/CollapsiblePanel';
import { parseTiers } from '@/lib/salary';
import { IconUsers, IconChart, IconWallet } from '@/components/icons';

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
 * рождения, позиция), разовые бонусы. Дальше сюда же вшиваются прочие
 * настройки.
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

  const rosterRows: RosterRow[] = (
    await prisma.buyer.findMany({
      where: { archived: false },
      orderBy: [{ owner: 'asc' }, { handle: 'asc' }],
      select: {
        id: true, handle: true, initials: true, color: true,
        startedAt: true, birthday: true, position: true, owner: true,
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
