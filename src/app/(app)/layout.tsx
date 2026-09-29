import { requireUser } from '@/lib/auth';
import { getActivityFeed } from '@/lib/activity';
import { prisma } from '@/lib/db';
import { canSeeTeam, type Role } from '@/lib/roles';
import { periodTitle, periodKeyOf } from '@/lib/period';
import Contours from '@/components/Contours';
import ScrollCalm from '@/components/ScrollCalm';
import TopBar from '@/components/TopBar';
import Workspace from '@/components/Workspace';
import {
  IconCalendar, IconChart, IconBox, IconPeak, IconTag, IconWallet, IconRocket, IconLink, IconMusic,
  IconPlay, IconUpload, IconFlag,
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
    { href: '/dashboard', label: team ? 'Сводка' : 'Мой кабинет', icon: <IconChart size={15} /> },
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
  // разделитель) — под TikTok. Разделитель отделяет группы, а у ТикТок свои
  // иконки: нотка (обзор/подключение), плей (кампании-ролики), стрелка (залив).
  const adsItems = [
    { href: '/ads', label: 'Обзор', icon: <IconChart size={15} /> },
    { href: '/ads/campaigns', label: 'Кампании', icon: <IconRocket size={15} /> },
    ...(team ? [{ href: '/ads/autorules', label: 'Автоправила', icon: <IconFlag size={15} /> }] : []),
    { href: '/ads/upload', label: 'Автозалив', icon: <IconTag size={15} /> },
    { href: '/ads/domains', label: 'Домены', icon: <IconLink size={15} />, divider: true },
    { href: '/tiktok', label: 'Обзор', icon: <IconMusic size={15} />, divider: true },
    { href: '/tiktok/campaigns', label: 'Кампании', icon: <IconPlay size={15} /> },
    { href: '/tiktok/upload', label: 'Автозалив', icon: <IconUpload size={15} /> },
  ];

  return (
    <div
      className="relative mx-auto flex min-h-screen max-w-[1600px] flex-col gap-2.5 p-2.5 sm:gap-3.5 sm:p-4"
      /* Скроллбар справа съедает ширину только справа, из-за чего mx-auto
         центрирует контент в области БЕЗ скроллбара — и правое поле шире левого
         на ширину скроллбара. Сдвигаем оболочку вправо на половину этой ширины
         (100vw−100% = ширина скроллбара), чтобы по краям было поровну. */
      style={{ left: 'calc((100vw - 100%) / 2)' }}
    >
      {/*
        Горизонтали живут на всём экране, а не внутри блока: панели чуть
        прозрачны, и рисунок проходит под ними насквозь. Слой держим на нулевом
        уровне, а содержимое поднимаем над ним: отрицательный z-index уводит
        фон под заливку body, и его попросту не видно.

        Ширина — ровно вьюпорт (w-screen = 100vw, включает зону скроллбара), а
        не область контента: fixed inset-0 упирался бы в скроллбар и обрывался,
        не доходя до правого края. Тянем от левого края (left-0) на всю ширину —
        линии доходят до обоих краёв, справа заходя под скроллбар.
      */}
      <Contours className="fixed left-0 top-0 z-0 h-screen w-screen" />
      <ScrollCalm />
      <div className="relative z-10 flex flex-1 flex-col gap-2.5 sm:gap-3.5">
      <TopBar
        title={team ? 'MS TEAM' : (user.buyer?.handle ?? user.name)}
        // В шапке неделя: вся статистика считается за неё.
        date={periodTitle(periodKeyOf(new Date()))}
        crew={crew.map((b) => ({ id: b.id, initials: b.initials, color: b.color, handle: b.handle }))}
        nav={<Workspace stats={statsItems} ads={adsItems} />}
        role={role}
        notif={await getActivityFeed({ id: user.id, role })}
      />
      {children}
      </div>
    </div>
  );
}
