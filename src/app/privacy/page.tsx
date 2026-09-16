import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Политика конфиденциальности — MS Dashboard',
  description: 'Как MS Dashboard обрабатывает и защищает данные.',
};

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-bg text-text">
      <header className="mx-auto flex max-w-3xl items-center justify-between px-5 py-5">
        <Link href="/" className="text-[15px] font-semibold tracking-tight">MS Dashboard</Link>
        <Link href="/login" className="rounded-full border border-line2 px-4 py-1.5 text-[12.5px] text-soft transition hover:border-sage hover:text-sage">Войти</Link>
      </header>
      <article className="mx-auto max-w-3xl px-5 py-8 text-[14px] leading-relaxed text-mute">
        <h1 className="text-[26px] font-bold text-text">Политика конфиденциальности</h1>
        <p className="mt-2 text-[12.5px] text-dim">Обновлено: {new Date().getFullYear()}</p>

        <h2 className="mt-7 text-[16px] font-semibold text-soft">1. Общие положения</h2>
        <p className="mt-2">
          MS Dashboard («платформа», «мы») — инструмент управления рекламой для команд медиабаинга. Настоящая
          политика описывает, какие данные мы обрабатываем и как их защищаем.
        </p>

        <h2 className="mt-6 text-[16px] font-semibold text-soft">2. Какие данные мы обрабатываем</h2>
        <p className="mt-2">
          Учётные данные пользователей платформы (имя, email), а также данные рекламных кабинетов, доступ к
          которым предоставлен их владельцами через официальные API рекламных платформ: идентификаторы и названия
          кабинетов, статистику расхода и результатов, структуру кампаний. Мы не запрашиваем и не храним пароли от
          сторонних сервисов.
        </p>

        <h2 className="mt-6 text-[16px] font-semibold text-soft">3. Как мы используем данные</h2>
        <p className="mt-2">
          Данные используются только для функций платформы: отображение аналитики, управление кампаниями и
          автоматизация публикаций. Мы не продаём данные третьим лицам.
        </p>

        <h2 className="mt-6 text-[16px] font-semibold text-soft">4. Доступ через сторонние API</h2>
        <p className="mt-2">
          Доступ к рекламным кабинетам осуществляется по токенам, выданным владельцами кабинетов через официальную
          авторизацию (OAuth). Владелец может в любой момент отозвать доступ на стороне рекламной платформы или
          отключить подключение в платформе.
        </p>

        <h2 className="mt-6 text-[16px] font-semibold text-soft">5. Хранение и защита</h2>
        <p className="mt-2">
          Токены доступа и данные хранятся в защищённой базе данных и используются только серверной частью
          платформы. Доступ ограничен авторизованными пользователями.
        </p>

        <h2 className="mt-6 text-[16px] font-semibold text-soft">6. Контакты</h2>
        <p className="mt-2">
          Вопросы по обработке данных: <a href="mailto:support@msdash.top" className="text-sage hover:underline">support@msdash.top</a>
        </p>

        <div className="mt-8">
          <Link href="/" className="text-[13px] text-sage hover:underline">← На главную</Link>
        </div>
      </article>
    </main>
  );
}
