import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { canSeeTeam, type Role } from '@/lib/roles';
import { periodTitle, periodKeyOf } from '@/lib/period';
import Contours from '@/components/Contours';
import ScrollCalm from '@/components/ScrollCalm';
import TopBar from '@/components/TopBar';
import Nav from '@/components/Nav';
import {
  IconCalendar, IconChart, IconBox, IconPeak, IconTag, IconWallet, IconLink,
} from '@/components/icons';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const role = user.role as Role;
  const team = canSeeTeam(role);

  const crew = await prisma.buyer.findMany({
    where: { archived: false, ...(team ? {} : { id: user.buyer?.id ?? '__none__' }) },
    orderBy: { handle: 'asc' },
    take: 8,
  });

  const items = [
    { href: '/', label: team ? 'Сводка' : 'Мой кабинет', icon: <IconChart size={15} /> },
    { href: '/peak', label: 'Вершина', icon: <IconPeak size={15} /> },
    { href: '/days', label: 'Дни', icon: <IconCalendar size={15} /> },
    { href: '/consumables', label: 'Расходники', icon: <IconBox size={15} /> },
    { href: '/attendance', label: 'Календарь', icon: <IconCalendar size={15} /> },
    { href: '/payroll', label: 'Зарплата', icon: <IconWallet size={15} /> },
    { href: '/offers', label: 'Офферы', icon: <IconTag size={15} /> },
  ];
  // Источники цифр настраивает только админ — под ключами доступ к кабинетам
  // и трекеру всей команды.
  if (role === 'ADMIN') {
    items.push({ href: '/integrations', label: 'Источники', icon: <IconLink size={15} /> });
  }

  return (
    <div className="relative mx-auto flex min-h-screen max-w-[1440px] flex-col gap-2.5 p-2.5 sm:gap-3.5 sm:p-4">
      {/*
        Горизонтали живут на всём экране, а не внутри блока: панели чуть
        прозрачны, и рисунок проходит под ними насквозь. Слой держим на нулевом
        уровне, а содержимое поднимаем над ним: отрицательный z-index уводит
        фон под заливку body, и его попросту не видно.
      */}
      <Contours className="fixed inset-0 z-0" />
      <ScrollCalm />
      <div className="relative z-10 flex flex-1 flex-col gap-2.5 sm:gap-3.5">
      <TopBar
        title={team ? 'MS TEAM' : (user.buyer?.handle ?? user.name)}
        // В шапке неделя: вся статистика считается за неё.
        date={periodTitle(periodKeyOf(new Date()))}
        crew={crew.map((b) => ({ id: b.id, initials: b.initials, color: b.color, handle: b.handle }))}
        nav={<Nav items={items} />}
        role={role}
      />
      {children}
      </div>
    </div>
  );
}
