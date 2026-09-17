import Link from 'next/link';

import { requireUser, scopeBuyerId } from '@/lib/auth';
import { canSeeTeam, type Role } from '@/lib/roles';
import { prisma } from '@/lib/db';
import { tiktokConfigured } from '@/lib/tiktok';
import { Panel, PanelHead, Empty } from '@/components/ui';
import TiktokUploadForm from '@/components/TiktokUploadForm';
import { type TiktokAccountLite } from '@/components/TiktokCampaigns';
import { IconUpload } from '@/components/icons';

const DEAD = new Set(['STATUS_DISABLE', 'STATUS_CONFIRM_FAIL', 'STATUS_PUNISH', 'STATUS_LIMIT']);

/** Автозалив TikTok — форма готова, боевой запуск включится с одобрением API. */
export default async function TiktokUploadPage() {
  const user = await requireUser();
  const team = canSeeTeam(user.role as Role);
  const scoped = scopeBuyerId(user);

  const tokens = await prisma.tiktokToken.findMany({
    where: team ? {} : { buyerId: scoped ?? '__none__' },
    include: { accounts: { orderBy: { name: 'asc' } } },
    orderBy: { createdAt: 'asc' },
  });

  const accounts: TiktokAccountLite[] = tokens.flatMap((t) =>
    t.accounts.map((a) => ({
      id: a.id,
      name: a.name,
      advertiserId: a.advertiserId,
      currency: a.currency,
      dead: DEAD.has(a.status),
    })),
  );

  return (
    <div className="flex flex-col gap-3.5">
      <Panel className="p-4 sm:p-6">
        <PanelHead
          icon={<IconUpload color="#b4c68c" />}
          tint="bg-sage-t"
          title="Автозалив TikTok"
          aside={<span className="text-[12.5px] text-mute">{accounts.length} кабинетов</span>}
        />

        {!tiktokConfigured() ? (
          <div className="mt-4 rounded-[12px] border border-amber/40 bg-amber-t px-3 py-2.5 text-[11.5px] leading-relaxed text-amber">
            Приложение TikTok ещё не подключено на сервере (нет app_id/secret). Форма ниже полностью
            рабочая — как только API одобрят и появятся ключи, автозалив заработает без доработок.
          </div>
        ) : null}

        <div className="mt-4">
          {accounts.length === 0 ? (
            <Empty>
              Нет подключённых кабинетов TikTok. Подключи их в{' '}
              <Link href="/tiktok" className="text-sage underline underline-offset-2">разделе «Обзор»</Link>.
            </Empty>
          ) : (
            <TiktokUploadForm accounts={accounts} />
          )}
        </div>
      </Panel>
    </div>
  );
}
