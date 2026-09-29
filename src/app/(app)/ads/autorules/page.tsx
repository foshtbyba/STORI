import { redirect } from 'next/navigation';

import { requireUser } from '@/lib/auth';
import { canSeeTeam, type Role } from '@/lib/roles';
import { Panel, PanelHead } from '@/components/ui';
import { IconFlag } from '@/components/icons';
import { listAutoRules, listAssignableAccounts, loadAutoRuleLog } from '@/app/actions/autorules';
import { METRICS, ACTIONS, FREQUENCIES, WINDOWS } from '@/lib/autorules';
import AutoRules from '@/components/AutoRules';

/**
 * Автоправила — команда (ADMIN/LEAD). Шаблоны условие+действие, вешаются на
 * кабинеты; крутит их наш крон (см. runAutoRules), т.к. только он видит ROI из
 * Keitaro. Расписание (dayparting) добавим отдельно нативными правилами FB.
 */
export default async function AutoRulesPage() {
  const user = await requireUser();
  if (!canSeeTeam(user.role as Role)) redirect('/ads');

  const [rulesR, accsR, logR] = await Promise.all([
    listAutoRules(),
    listAssignableAccounts(),
    loadAutoRuleLog(),
  ]);

  return (
    <div className="flex flex-col gap-3.5">
      <Panel className="p-4 sm:p-6">
        <PanelHead
          icon={<IconFlag color="#b4c68c" />}
          tint="bg-sage-t"
          title="Автоправила"
          aside={<span className="text-[12.5px] text-mute">{rulesR.rules?.length ?? 0} правил</span>}
        />
        <div className="mt-4">
          <AutoRules
            initialRules={rulesR.rules ?? []}
            accounts={accsR.accounts ?? []}
            initialLog={logR.rows ?? []}
            metrics={METRICS.map((m) => ({ key: m.key, label: m.label, unit: m.unit }))}
            actions={ACTIONS.map((a) => ({ key: a.key, label: a.label }))}
            frequencies={FREQUENCIES.map((f) => ({ key: f.key, label: f.label }))}
            windows={WINDOWS.map((w) => ({ key: w.key, label: w.label }))}
          />
        </div>
      </Panel>
    </div>
  );
}
