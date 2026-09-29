import { redirect } from 'next/navigation';

import { requireUser } from '@/lib/auth';
import { canSeeTeam, type Role } from '@/lib/roles';
import { Panel, PanelHead } from '@/components/ui';
import { IconFlag } from '@/components/icons';
import { listAutoRules, listAssignableAccounts, loadAutoRuleLog } from '@/app/actions/autorules';
import { AUTO_RULE_TYPES } from '@/lib/autorules';
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
            types={AUTO_RULE_TYPES.map((t) => ({ type: t.type, label: t.label }))}
          />
        </div>
      </Panel>
    </div>
  );
}
