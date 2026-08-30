import { destroySession } from '@/lib/session';
import { redirect } from 'next/navigation';
import { Avatar, Panel } from './ui';
import { IconLogout } from './icons';
import WorkspaceLogo from './WorkspaceLogo';

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
    <Panel as="div" className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 p-2.5 sm:h-[78px] sm:flex-nowrap sm:gap-6 sm:p-0 sm:pl-4 sm:pr-3.5">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2.5 gap-y-2 sm:flex-nowrap sm:overflow-hidden sm:gap-4">
        <WorkspaceLogo />
        <span className="shrink-0 text-[15px] font-bold tracking-[-0.02em] sm:text-[19px]">{title}</span>
        <span className="hidden h-[22px] w-px shrink-0 bg-line2 md:block" />
        <span className="n hidden shrink-0 text-[15px] text-mid md:block">{date}</span>
        {nav}
        {role ? (
          <span className="lab ml-auto hidden shrink-0 whitespace-nowrap pl-4 lg:block">{role}</span>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-2 self-start pt-0.5 sm:gap-4 sm:self-auto sm:pt-0">
        <span className="hidden items-center gap-3 rounded-full bg-sub py-1.5 pl-3.5 pr-3 xl:flex">
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
