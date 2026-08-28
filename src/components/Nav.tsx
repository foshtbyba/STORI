'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

export type NavItem = { href: string; label: string; icon: ReactNode };

export default function Nav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav className="no-scrollbar order-3 flex basis-full items-center gap-1 overflow-x-auto rounded-full bg-sub p-1 sm:order-none sm:min-w-0 sm:basis-auto">
      {items.map((item) => {
        const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={`flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-[12.5px] transition ${
              active ? 'bg-raise font-semibold text-text' : 'text-mute hover:text-soft'
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
