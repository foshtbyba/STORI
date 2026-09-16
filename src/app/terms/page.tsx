import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Условия использования — MS Dashboard',
  description: 'Условия использования платформы MS Dashboard.',
};

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-bg text-text">
      <header className="mx-auto flex max-w-3xl items-center justify-between px-5 py-5">
        <Link href="/" className="text-[15px] font-semibold tracking-tight">MS Dashboard</Link>
        <Link href="/login" className="rounded-full border border-line2 px-4 py-1.5 text-[12.5px] text-soft transition hover:border-sage hover:text-sage">Войти</Link>
      </header>
      <article className="mx-auto max-w-3xl px-5 py-8 text-[14px] leading-relaxed text-mute">
        <h1 className="text-[26px] font-bold text-text">Условия использования</h1>
        <p className="mt-2 text-[12.5px] text-dim">Обновлено: {new Date().getFullYear()}</p>

        <h2 className="mt-7 text-[16px] font-semibold text-soft">1. Назначение</h2>
        <p className="mt-2">
          MS Dashboard — внутренняя платформа для управления рекламой и аналитики. Доступ предоставляется
          авторизованным пользователям команды.
        </p>

        <h2 className="mt-6 text-[16px] font-semibold text-soft">2. Использование</h2>
        <p className="mt-2">
          Пользователь обязуется использовать платформу в рамках применимого законодательства и правил рекламных
          платформ, к API которых он подключает свои кабинеты. Ответственность за содержание рекламы и соблюдение
          правил площадок несёт владелец кабинета.
        </p>

        <h2 className="mt-6 text-[16px] font-semibold text-soft">3. Доступ к сторонним сервисам</h2>
        <p className="mt-2">
          Подключение рекламных кабинетов выполняется через официальную авторизацию соответствующих платформ.
          Пользователь подтверждает, что имеет право предоставлять такой доступ, и может отозвать его в любой момент.
        </p>

        <h2 className="mt-6 text-[16px] font-semibold text-soft">4. Ограничение ответственности</h2>
        <p className="mt-2">
          Платформа предоставляется «как есть». Мы стремимся к бесперебойной работе, но не гарантируем отсутствие
          сбоев сторонних API и сервисов.
        </p>

        <h2 className="mt-6 text-[16px] font-semibold text-soft">5. Контакты</h2>
        <p className="mt-2">
          Вопросы по условиям: <a href="mailto:support@msdash.top" className="text-sage hover:underline">support@msdash.top</a>
        </p>

        <div className="mt-8">
          <Link href="/" className="text-[13px] text-sage hover:underline">← На главную</Link>
        </div>
      </article>
    </main>
  );
}
