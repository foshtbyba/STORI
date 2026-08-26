import { requireUser, scopeBuyerId } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { canSeeTeam, type Role } from '@/lib/roles';
import DayForm from '@/components/DayForm';
import QuickImport from '@/components/QuickImport';

export default async function NewDayPage() {
  const user = await requireUser();
  const team = canSeeTeam(user.role as Role);
  const scoped = scopeBuyerId(user);

  const [buyers, offers, methods] = await Promise.all([
    prisma.buyer.findMany({
      where: { archived: false, ...(scoped ? { id: scoped } : {}) },
      orderBy: { handle: 'asc' },
    }),
    prisma.offer.findMany({ where: { status: { in: ['ACTIVE', 'TEST'] } }, orderBy: { name: 'asc' } }),
    prisma.paymentMethod.findMany({ where: { archived: false }, orderBy: { name: 'asc' } }),
  ]);

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="flex flex-col gap-3.5">
      <DayForm
        today={today}
        buyers={buyers.map((b) => ({ id: b.id, label: b.handle }))}
        offers={offers.map((o) => ({ id: o.id, label: o.name }))}
        methods={methods.map((m) => ({ id: m.id, label: m.name, bps: m.commissionBps }))}
        lockedBuyerId={scoped}
      />
      {team ? (
        <QuickImport
          today={today}
          defaultBps={methods[0]?.commissionBps ?? 450}
          knownHandles={buyers.map((b) => b.handle)}
        />
      ) : null}
    </div>
  );
}
