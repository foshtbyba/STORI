import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { canSeeTeam, type Role } from '@/lib/roles';
import { currentPeriodKey, teamSummary } from '@/lib/queries';
import { periodLabel } from '@/lib/period';
import { usd } from '@/lib/money';
import TopBar from '@/components/TopBar';
import Nav from '@/components/Nav';
import {
  IconCalendar, IconChart, IconBox, IconPeak, IconTag, IconWallet,
} from '@/components/icons';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const role = user.role as Role;
  const team = canSeeTeam(role);
  const key = await currentPeriodKey();

  const crew = await prisma.buyer.findMany({
    where: { archived: false, ...(team ? {} : { id: user.buyer?.id ?? '__none__' }) },
    orderBy: { handle: 'asc' },
    take: 8,
  });

  const summary = team ? await teamSummary(key) : null;
  const own = !team && user.buyer ? await teamSummary(key) : null;
  const mine = own?.buyers.find((b) => b.buyer.id === user.buyer?.id);

  const items = [
    { href: '/', label: team ? 'Сводка' : 'Мой кабинет', icon: <IconChart size={15} /> },
    { href: '/peak', label: 'Вершина', icon: <IconPeak size={15} /> },
    { href: '/days', label: 'Дни', icon: <IconCalendar size={15} /> },
    { href: '/consumables', label: 'Расходники', icon: <IconBox size={15} /> },
    ...(team ? [{ href: '/payroll', label: 'Зарплата', icon: <IconWallet size={15} /> }] : []),
    { href: '/offers', label: 'Офферы', icon: <IconTag size={15} /> },
  ];

  return (
    <div className="mx-auto flex min-h-screen max-w-[1440px] flex-col gap-3.5 p-4">
      <TopBar
        title={team ? 'MS TEAM' : (user.buyer?.handle ?? user.name)}
        date={periodLabel(key)}
        crew={crew.map((b) => ({ id: b.id, initials: b.initials, color: b.color, handle: b.handle }))}
        nav={<Nav items={items} />}
        role={`${user.name} · ${role === 'ADMIN' ? 'админ' : role === 'LEAD' ? 'тимлид' : 'баер'}`}
      />
      {children}
    </div>
  );
}
