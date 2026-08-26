import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { verifyPassword } from '@/lib/auth';
import { createSession } from '@/lib/session';
import { currentUser } from '@/lib/session';
import { Panel } from '@/components/ui';
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
    // Same message either way: a login form should not confirm which
    // addresses exist.
    if (!user || !user.active || !(await verifyPassword(password, user.passwordHash))) {
      redirect('/login?error=1');
    }
    await createSession({ sub: user.id, role: user.role as Role, name: user.name });
    redirect('/');
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Panel as="div" className="w-full max-w-[420px] p-8">
        <div className="flex items-center gap-3">
          <span className="flex h-[42px] w-[42px] items-center justify-center rounded-full bg-sage-t">
            <IconPeak color="#b4c68c" size={22} />
          </span>
          <div>
            <div className="text-[19px] font-bold tracking-[-0.02em]">MS TEAM</div>
            <div className="text-[12.5px] text-mute">учёт команды</div>
          </div>
        </div>

        <form action={signIn} className="mt-8 flex flex-col gap-3">
          <label className="rounded-[18px] bg-sub px-4 py-3">
            <span className="text-[11.5px] text-mute">Почта</span>
            <input
              name="email"
              type="email"
              required
              autoComplete="username"
              className="mt-1.5 w-full bg-transparent text-[15px] outline-none"
              placeholder="admin@ms.team"
            />
          </label>
          <label className="rounded-[18px] bg-sub px-4 py-3">
            <span className="text-[11.5px] text-mute">Пароль</span>
            <input
              name="password"
              type="password"
              required
              autoComplete="current-password"
              className="mt-1.5 w-full bg-transparent text-[15px] outline-none"
            />
          </label>

          {error ? (
            <p className="rounded-[14px] bg-rust-t px-4 py-3 text-[12.5px] text-rust">
              Неверная почта или пароль.
            </p>
          ) : null}

          <button
            type="submit"
            className="mt-2 rounded-full bg-sage py-3 text-[13.5px] font-semibold text-bg transition hover:opacity-90"
          >
            Войти
          </button>
        </form>
      </Panel>
    </main>
  );
}
