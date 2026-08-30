'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import Nav, { type NavItem } from './Nav';

/**
 * Меню активного пространства. Само пространство переключается кликом по горе-
 * логотипу (см. WorkspaceLogo), а здесь только показываем нужный набор пунктов:
 * всё под /ads — «Реклама», остальное — «Статистика».
 */
export default function Workspace({ stats, ads }: { stats: NavItem[]; ads: NavItem[] }) {
  const pathname = usePathname();
  const inAds = pathname.startsWith('/ads');
  return <Nav items={inAds ? ads : stats} />;
}

export type { NavItem, ReactNode };
