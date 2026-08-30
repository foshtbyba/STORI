'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import Nav, { type NavItem } from './Nav';
import { IconChart, IconRocket } from './icons';

/**
 * Переключатель рабочих пространств: «Статистика» и «Реклама».
 *
 * Отчётность и управление рекламой — два разных мира, и в одном ряду меню они
 * перегружают шапку. Поэтому вверху тумблер на два пространства, а меню под ним
 * своё для каждого. Пространство определяем по адресу: всё под /ads — это
 * «Реклама», остальное — «Статистика».
 */
export default function Workspace({ stats, ads }: { stats: NavItem[]; ads: NavItem[] }) {
  const pathname = usePathname();
  const inAds = pathname.startsWith('/ads');
  const items = inAds ? ads : stats;

  const tab = (active: boolean) =>
    `flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] font-semibold transition ${
      active ? 'bg-raise text-text' : 'text-mute hover:text-soft'
    }`;

  return (
    <div className="order-3 flex min-w-0 basis-full items-center gap-2 sm:order-none sm:basis-auto">
      <span className="flex shrink-0 items-center gap-1 rounded-full bg-sub p-1">
        <Link href="/" className={tab(!inAds)} aria-current={!inAds ? 'page' : undefined}>
          <IconChart size={14} />
          <span className="hidden sm:inline">Статистика</span>
        </Link>
        <Link href="/ads" className={tab(inAds)} aria-current={inAds ? 'page' : undefined}>
          <IconRocket size={14} />
          <span className="hidden sm:inline">Реклама</span>
        </Link>
      </span>
      <Nav items={items} />
    </div>
  );
}

export type { NavItem, ReactNode };
