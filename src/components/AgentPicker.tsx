'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setAccountAgent } from '@/app/actions/integrations';
import AgentSelect, { type AgentOpt } from './AgentSelect';

export type { AgentOpt };

/**
 * Выбор агента для агентского кабинета (Интеграции). Обёртка над AgentSelect,
 * которая сохраняет выбор через server action setAccountAgent.
 */
export default function AgentPicker({
  accountId,
  agents,
  currentId,
}: {
  accountId: string;
  agents: AgentOpt[];
  currentId: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const onChange = (id: string) => {
    const fd = new FormData();
    fd.set('id', accountId);
    fd.set('agentId', id);
    start(async () => { await setAccountAgent(fd); router.refresh(); });
  };

  return <AgentSelect value={currentId ?? ''} agents={agents} onChange={onChange} disabled={pending} size="sm" />;
}
