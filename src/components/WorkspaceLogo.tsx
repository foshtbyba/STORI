'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { IconPeak, IconRocket } from './icons';

/**
 * Логотип-переключатель. Гора слева от названия — это тумблер на два
 * пространства: из «Статистики» уводит в «Рекламу» и наоборот. Отдельной
 * пилюли в меню больше нет — вход один, через логотип.
 *
 * Значок сам показывает, где ты: гора — статистика, ракета — реклама, так что
 * по нему видно и текущий режим, и куда переключит клик.
 */
export default function WorkspaceLogo() {
  const pathname = usePathname();
  // TikTok-раздел тоже относится к пространству «Реклама».
  const inAds = pathname.startsWith('/ads') || pathname.startsWith('/tiktok');
  const href = inAds ? '/' : '/ads';
  const Icon = inAds ? IconRocket : IconPeak;

  return (
    <Link
      href={href}
      title={inAds ? 'В статистику' : 'В рекламу'}
      aria-label={inAds ? 'Переключить на статистику' : 'Переключить на рекламу'}
      className="group relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition sm:h-[42px] sm:w-[42px]"
      style={{ background: inAds ? '#2e271c' : '#252e1e' }}
    >
      <Icon color={inAds ? '#d2a06a' : '#b4c68c'} size={19} />
      {/* Точка-подсказка: намекает, что гора кликабельна и переключает. */}
      <span
        className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-panel transition group-hover:scale-110"
        style={{ background: inAds ? '#b4c68c' : '#d2a06a' }}
      />
    </Link>
  );
}
