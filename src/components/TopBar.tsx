import Link from 'next/link';
import { destroySession } from '@/lib/session';
import { redirect } from 'next/navigation';
import { Avatar, Panel } from './ui';
import { IconPeak, IconPin, IconLogout } from './icons';

export type Crew = { id: string; initials: string; color: string; handle: string };

export default function TopBar({
  title,
  date,
  meta,
  metric,
  crew,
}: {
  title: string;
  date: string;
  meta: string;
  metric: string;
  crew: Crew[];
}) {
  async function signOut() {
    'use server';
    await destroySession();
    redirect('/login');
  }

  return (
    <Panel as="div" className="flex h-[78px] items-center justify-between pl-4 pr-3.5">
      <div className="flex items-center gap-4">
        <Link href="/" className="flex h-[42px] w-[42px] items-center justify-center rounded-full bg-sage-t">
          <IconPeak color="#b4c68c" size={22} />
        </Link>
        <span className="text-[19px] font-bold tracking-[-0.02em]">{title}</span>
        <span className="h-[22px] w-px bg-line2" />
        <span className="n text-[16px] text-mid">{date}</span>
      </div>

      <div className="flex items-center gap-5">
        <span className="flex items-center gap-2.5">
          <IconPin color="#6fa9a0" size={16} />
          <span className="text-[14px] text-soft">{meta}</span>
        </span>
        <span className="h-5 w-px bg-line" />
        <span className="flex items-center gap-2.5">
          <IconPeak color="#b4c68c" size={16} />
          <span className="n text-[14px] text-sage">{metric}</span>
        </span>

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
