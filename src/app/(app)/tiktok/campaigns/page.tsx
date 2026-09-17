import Link from 'next/link';

import { requireUser, scopeBuyerId } from '@/lib/auth';
import { canSeeTeam, type Role } from '@/lib/roles';
import { prisma } from '@/lib/db';
import { Panel, PanelHead, Empty } from '@/components/ui';
import TiktokCampaigns, { type TiktokAccountLite } from '@/components/TiktokCampaigns';
import { IconPlay } from '@/components/icons';

const DEAD = new Set(['STATUS_DISABLE', 'STATUS_CONFIRM_FAIL', 'STATUS_PUNISH', 'STATUS_LIMIT']);

/** Кампании TikTok — зеркало FB-кампаний. Данные тянутся по кабинету на месте. */
export default async function TiktokCampaignsPage() {
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
          icon={<IconPlay color="#b4c68c" />}
          tint="bg-sage-t"
          title="Кампании TikTok"
          aside={<span className="text-[12.5px] text-mute">{accounts.length} кабинетов</span>}
        />
        <div className="mt-4">
          {accounts.length === 0 ? (
            <Empty>
              Нет подключённых кабинетов TikTok. Подключи их в{' '}
              <Link href="/tiktok" className="text-sage underline underline-offset-2">разделе «Обзор»</Link>.
            </Empty>
          ) : (
            <TiktokCampaigns accounts={accounts} />
          )}
        </div>
      </Panel>
    </div>
  );
}
