import Link from 'next/link';
import { destroySession } from '@/lib/session';
import { redirect } from 'next/navigation';
import { Avatar, Panel } from './ui';
import { IconPeak, IconLogout } from './icons';

export type Crew = { id: string; initials: string; color: string; handle: string };

export default function TopBar({
  title,
  date,
  crew,
  nav,
  role,
}: {
  title: string;
  date: string;
  crew: Crew[];
  nav?: React.ReactNode;
  role?: string;
}) {
  async function signOut() {
    'use server';
    await destroySession();
    redirect('/login');
  }

  return (
    <Panel as="div" className="flex h-[78px] items-center justify-between gap-6 pl-4 pr-3.5">
      <div className="flex min-w-0 flex-1 items-center gap-4 overflow-hidden">
        <Link href="/" className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full bg-sage-t">
          <IconPeak color="#b4c68c" size={22} />
        </Link>
        <span className="shrink-0 text-[19px] font-bold tracking-[-0.02em]">{title}</span>
        <span className="h-[22px] w-px shrink-0 bg-line2" />
        <span className="n shrink-0 text-[15px] text-mid">{date}</span>
        {nav}
        {role ? <span className="lab ml-auto shrink-0 whitespace-nowrap pl-4">{role}</span> : null}
      </div>

      <div className="flex shrink-0 items-center gap-4">
        <span className="flex items-center gap-3 rounded-full bg-sub py-1.5 pl-3.5 pr-3">
          <span className="flex">
            {crew.map((c) => (
              <span key={c.id} className="-ml-2.5 rounded-full border-2 border-panel first:ml-0" title={c.handle}>
                <Avatar initials={c.initials} color={c.color} size={30} />
              </span>
            ))}
          </span>
        </span>

        <form action={signOut}>
          <button
            type="submit"
            className="flex h-8 w-8 items-center justify-center rounded-full bg-sub transition hover:bg-raise"
            aria-label="Выйти"
            title="Выйти"
          >
            <IconLogout color="#8a8a8a" size={15} />
          </button>
        </form>
      </div>
    </Panel>
  );
}
