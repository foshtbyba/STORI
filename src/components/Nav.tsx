'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

export type NavItem = { href: string; label: string; icon: ReactNode };

export default function Nav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  // Активна ровно одна вкладка — та, чей адрес совпал точнее всех (самый
  // длинный префикс). Иначе «/ads» (Обзор) горел бы и на «/ads/campaigns»,
  // где своя вкладка. Точное совпадение всегда бьёт префикс.
  const matches = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const activeHref = items
    .filter((it) => matches(it.href))
    .reduce((best, it) => (it.href.length > best.length ? it.href : best), '');
  return (
    <nav className="no-scrollbar flex min-w-0 flex-1 items-center gap-1 overflow-x-auto rounded-full bg-sub p-1 sm:flex-none sm:basis-auto">
      {items.map((item) => {
        const active = item.href === activeHref;
        return (
          <Link
            key={item.href}
            href={item.href}
            /*
              Каждая страница здесь динамическая: предзагрузка не может её
              закешировать, зато честно тянет с сервера семь отрисовок с
              запросами в базу при каждом заходе. Отдачи ноль, счёт реальный.
            */
            prefetch={false}
            aria-current={active ? 'page' : undefined}
            className={`flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-[12.5px] transition duration-100 active:scale-[0.96] ${
              active ? 'bg-raise font-semibold text-text' : 'text-mute hover:bg-raise/50 hover:text-soft active:bg-raise active:text-text'
            }`}
          >
            {item.icon}
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
