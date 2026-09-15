'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import Nav, { type NavItem } from './Nav';

/**
 * Меню активного пространства. Само пространство переключается кликом по горе-
 * логотипу (см. WorkspaceLogo), а здесь только показываем нужный набор пунктов:
 * всё под /ads и /tiktok — «Реклама» (первый набор вкладок под FB, второй под
 * TikTok в той же строке), остальное — «Статистика».
 */
export default function Workspace({ stats, ads }: { stats: NavItem[]; ads: NavItem[] }) {
  const pathname = usePathname();
  const inAds = pathname.startsWith('/ads') || pathname.startsWith('/tiktok');
  return <Nav items={inAds ? ads : stats} />;
}

export type { NavItem, ReactNode };
