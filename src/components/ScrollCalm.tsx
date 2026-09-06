'use client';

import { useEffect } from 'react';

/**
 * Пока страницу листают — фон стоит.
 *
 * Горизонтали на фоне медленно едут, а панели поверх них полупрозрачны. Пока
 * фон двигается, браузер на каждом кадре прокрутки заново смешивает весь
 * экран: содержимое нельзя просто сдвинуть, под ним всё время новая картинка.
 * Клики от этого не страдают — а вот прокрутка дёргается.
 *
 * Поэтому на время прокрутки ставим на `<html>` метку, по которой анимация
 * замирает, и снимаем её через сто пятьдесят миллисекунд после последнего
 * события. Движение возвращается ровно тогда, когда на него есть кто смотреть.
 *
 * Слушатель пассивный и ничего не перерисовывает в React: он трогает один
 * атрибут, и то не чаще, чем меняется состояние.
 */
export default function ScrollCalm() {
  useEffect(() => {
    const root = document.documentElement;
    let idle: ReturnType<typeof setTimeout> | undefined;
    let moving = false;

    function onScroll() {
      if (!moving) {
        moving = true;
        root.dataset.scrolling = '1';
      }
      clearTimeout(idle);
      idle = setTimeout(() => {
        moving = false;
        delete root.dataset.scrolling;
      }, 150);
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      clearTimeout(idle);
      delete root.dataset.scrolling;
    };
  }, []);

  return null;
}
