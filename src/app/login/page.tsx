import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { verifyPassword } from '@/lib/auth';
import { createSession, currentUser } from '@/lib/session';
import { IconPeak } from '@/components/icons';
import type { Role } from '@/lib/roles';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (await currentUser()) redirect('/');
  const { error } = await searchParams;

  async function signIn(formData: FormData) {
    'use server';
    const email = String(formData.get('email') ?? '').trim().toLowerCase();
    const password = String(formData.get('password') ?? '');

    const user = await prisma.user.findUnique({ where: { email } });
    // Одинаковый ответ в обоих случаях: форма входа не должна подсказывать,
    // какие адреса заведены.
    if (!user || !user.active || !(await verifyPassword(password, user.passwordHash))) {
      redirect('/login?error=1');
    }
    await createSession({ sub: user.id, role: user.role as Role, name: user.name });
    redirect('/');
  }

  const field =
    'mt-2 h-11 w-full rounded-xl border border-line bg-sub px-3.5 text-[14.5px] outline-none transition focus:border-sage';

  return (
    <main className="flex min-h-screen items-center justify-center p-5">
      <div className="w-full max-w-[360px]">
        <div className="mb-7 flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-sage-t">
            <IconPeak color="#b4c68c" size={22} />
          </span>
          <span className="text-[20px] font-bold tracking-[-0.02em]">MS TEAM</span>
        </div>

        <form action={signIn} className="rounded-[22px] border border-line bg-panel p-6">
          <h1 className="text-[17px] font-semibold">Вход</h1>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-mute">
            Доступ выдаёт администратор команды — он же присылает почту и пароль.
          </p>

          <label className="mt-5 block">
            <span className="text-[12px] text-soft">Почта</span>
            <input
              name="email"
              type="email"
              required
              autoComplete="username"
              autoFocus
              className={field}
            />
          </label>

          <label className="mt-3.5 block">
            <span className="text-[12px] text-soft">Пароль</span>
            <input
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className={field}
            />
          </label>

          {error ? (
            <p className="mt-4 rounded-xl bg-rust-t px-3.5 py-2.5 text-[12.5px] text-rust">
              Не подошли почта или пароль. Проверь раскладку и регистр.
            </p>
          ) : null}

          <button
            type="submit"
            className="mt-5 h-11 w-full rounded-xl bg-sage text-[13.5px] font-semibold text-bg transition hover:opacity-90"
          >
            Войти
          </button>
        </form>

        <p className="mt-4 text-center text-[11.5px] text-dim">
          Забыл пароль — попроси админа выдать новый.
        </p>
      </div>
    </main>
  );
}
