import type { Metadata } from 'next';
import Link from 'next/link';
import JoinTeamForm from '@/components/JoinTeamForm';

/**
 * Публичная страница-визитка (лендинг) на корне домена. Открывается БЕЗ
 * авторизации — её видят гости и, в частности, ревьюеры при верификации
 * доступа к внешним API. Залогиненные пользователи работают в дашборде
 * (/dashboard) и в разделах приложения; сюда попадают только гости.
 */
export const metadata: Metadata = {
  title: 'MS Dashboard — платформа управления рекламой',
  description:
    'MS Dashboard — аналитическая платформа для команд медиабаинга: расход и результаты рекламных кабинетов, управление кампаниями и автоматизация публикации креативов.',
};

const features = [
  {
    title: 'Аналитика расхода',
    text: 'Сводка расхода, показов, кликов и результатов по рекламным кабинетам в одном месте — по дням, неделям и командам.',
  },
  {
    title: 'Управление кабинетами',
    text: 'Подключение рекламных кабинетов, контроль статусов и балансов, быстрый поиск и группировка.',
  },
  {
    title: 'Управление кампаниями',
    text: 'Пауза и запуск, правка бюджетов и структура «кампания → группа → объявление» прямо из панели.',
  },
  {
    title: 'Автоматизация публикаций',
    text: 'Сборка кампаний по шаблонам, загрузка креативов и мультиязычные объявления — без ручной рутины.',
  },
];

export default function LandingPage() {
  return (
    <main className="min-h-screen bg-bg text-text">
      {/* Шапка */}
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-sage-t text-sage">
            <span className="text-[15px] font-bold">M</span>
          </div>
          <span className="text-[15px] font-semibold tracking-tight">MS Dashboard</span>
        </div>
        <Link
          href="/login"
          className="rounded-full border border-sage bg-sage-t px-5 py-2 text-[13px] font-semibold text-sage transition hover:brightness-110"
        >
          Войти
        </Link>
      </header>

      {/* Герой */}
      <section className="mx-auto max-w-6xl px-5 pb-8 pt-10 sm:pt-16">
        <h1 className="max-w-3xl text-[30px] font-bold leading-tight tracking-tight sm:text-[42px]">
          Управление рекламой и аналитика для команд медиабаинга
        </h1>
        <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-mute">
          MS Dashboard объединяет расход, результаты и управление рекламными кабинетами в одной панели.
          Подключайте кабинеты, следите за эффективностью, управляйте кампаниями и автоматизируйте публикацию
          креативов — по Facebook и TikTok.
        </p>
        <div className="mt-7 flex flex-wrap items-center gap-3">
          <Link
            href="/login"
            className="rounded-full border border-sage bg-sage-t px-6 py-2.5 text-[13.5px] font-semibold text-sage transition hover:brightness-110"
          >
            Войти в платформу
          </Link>
          <a
            href="#features"
            className="rounded-full border border-line2 px-6 py-2.5 text-[13.5px] font-semibold text-soft transition hover:border-sage hover:text-sage"
          >
            Возможности
          </a>
        </div>
      </section>

      {/* Возможности */}
      <section id="features" className="mx-auto max-w-6xl px-5 py-10">
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-amber">Возможности</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {features.map((f) => (
            <div key={f.title} className="rounded-[16px] border border-line bg-sub p-5">
              <div className="text-[15px] font-semibold text-soft">{f.title}</div>
              <p className="mt-2 text-[13.5px] leading-relaxed text-mute">{f.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* О платформе */}
      <section className="mx-auto max-w-6xl px-5 py-10">
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-amber">О платформе</h2>
        <p className="mt-4 max-w-3xl text-[14px] leading-relaxed text-mute">
          MS Dashboard — это внутренний инструмент рекламной команды для работы с рекламными кабинетами:
          сбор статистики расхода и результатов, контроль статусов кабинетов, управление кампаниями и
          автоматизация публикации креативов. Интеграции с рекламными платформами используются исключительно
          для аккаунтов, доступ к которым предоставлен их владельцами.
        </p>
      </section>

      {/* В команду */}
      <section className="mx-auto max-w-6xl px-5 py-10">
        <div className="rounded-[18px] border border-sage/30 bg-sage-t/40 p-6 sm:p-8">
          <h2 className="text-[20px] font-bold text-soft sm:text-[24px]">Хочешь попасть в нашу команду?</h2>
          <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-mute">
            Мы всегда ищем сильных медиабайеров. Оставь свой Telegram — и мы свяжемся с тобой.
          </p>
          <div className="max-w-xl">
            <JoinTeamForm />
          </div>
        </div>
      </section>

      {/* Контакты */}
      <section className="mx-auto max-w-6xl px-5 py-10">
        <h2 className="text-[13px] font-semibold uppercase tracking-wide text-amber">Контакты</h2>
        <p className="mt-4 text-[14px] text-mute">
          По вопросам сотрудничества и доступа: <a href="mailto:support@msdash.top" className="text-sage hover:underline">support@msdash.top</a>
        </p>
      </section>

      {/* Подвал */}
      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-6 text-[12.5px] text-dim">
          <span>© {new Date().getFullYear()} MS Dashboard</span>
          <nav className="flex items-center gap-4">
            <Link href="/privacy" className="transition hover:text-soft">Политика конфиденциальности</Link>
            <Link href="/terms" className="transition hover:text-soft">Условия использования</Link>
            <Link href="/login" className="transition hover:text-soft">Войти</Link>
          </nav>
        </div>
      </footer>
    </main>
  );
}
