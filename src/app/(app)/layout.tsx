import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { canSeeTeam, type Role } from '@/lib/roles';
import { periodTitle, periodKeyOf } from '@/lib/period';
import Contours from '@/components/Contours';
import ScrollCalm from '@/components/ScrollCalm';
import TopBar from '@/components/TopBar';
import Workspace from '@/components/Workspace';
import {
  IconCalendar, IconChart, IconBox, IconPeak, IconTag, IconWallet, IconRocket, IconLink, IconMusic,
} from '@/components/icons';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const role = user.role as Role;
  const team = canSeeTeam(role);

  // Овнеров в общей ленте аватаров не показываем — они видны только на своём
  // листе у админа, а не всей команде в шапке.
  const crew = await prisma.buyer.findMany({
    where: { archived: false, owner: false, ...(team ? {} : { id: user.buyer?.id ?? '__none__' }) },
    orderBy: { handle: 'asc' },
    take: 8,
  });

  // Пространство «Статистика»: отчётность, зарплата, офферы.
  const statsItems = [
    { href: '/', label: team ? 'Сводка' : 'Мой кабинет', icon: <IconChart size={15} /> },
    { href: '/peak', label: 'Вершина', icon: <IconPeak size={15} /> },
    { href: '/days', label: 'Дни', icon: <IconCalendar size={15} /> },
    { href: '/consumables', label: 'Расходники', icon: <IconBox size={15} /> },
    { href: '/attendance', label: 'Календарь', icon: <IconCalendar size={15} /> },
    { href: '/payroll', label: 'Зарплата', icon: <IconWallet size={15} /> },
    ...(role === 'ADMIN' ? [{ href: '/treasury', label: 'Касса', icon: <IconWallet size={15} /> }] : []),
    { href: '/offers', label: 'Офферы', icon: <IconTag size={15} /> },
  ];
  // Отдельной вкладки «Источники» больше нет: ключи от Brocard и Keitaro
  // переехали в админку (их трогают раз в жизни), а кабинеты Facebook — в окно
  // «Реклама», где их и смотрят каждый день.

  // Пространство «Реклама»: техничка — мониторинг, управление, автозалив.
  // Первый набор вкладок — под Facebook, второй (после «Домены», через
  // разделитель) — под TikTok. У ТикТок-вкладок нотка-иконка, чтобы отличать
  // их от одноимённых FB-вкладок.
  const adsItems = [
    { href: '/ads', label: 'Обзор', icon: <IconChart size={15} /> },
    { href: '/ads/campaigns', label: 'Кампании', icon: <IconRocket size={15} /> },
    { href: '/ads/upload', label: 'Автозалив', icon: <IconTag size={15} /> },
    { href: '/ads/domains', label: 'Домены', icon: <IconLink size={15} />, divider: true },
    { href: '/tiktok', label: 'Обзор', icon: <IconMusic size={15} />, divider: true },
    { href: '/tiktok/campaigns', label: 'Кампании', icon: <IconMusic size={15} /> },
    { href: '/tiktok/upload', label: 'Автозалив', icon: <IconMusic size={15} /> },
  ];

  return (
    <div className="relative mx-auto flex min-h-screen max-w-[1600px] flex-col gap-2.5 p-2.5 sm:gap-3.5 sm:p-4">
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
        nav={<Workspace stats={statsItems} ads={adsItems} />}
        role={role}
      />
      {children}
      </div>
    </div>
  );
}
