import type { ReactNode } from 'react';
import { Panel, PanelHead, Empty } from '@/components/ui';
import { IconMusic } from '@/components/icons';

/**
 * Заготовка раздела TikTok. Вкладки (Обзор/Кампании/Автозалив) уже живут в шапке
 * рядом с FB-набором, но интеграция с TikTok Business API (аккаунты, статистика,
 * автозалив роликов) ещё не подключена — нужен доступ и токены рекламного
 * кабинета TikTok. До этого показываем аккуратную заглушку той же формы, что и
 * FB-разделы, чтобы структура была на месте.
 */
export default function TiktokSoon({
  title,
  lead,
  points,
}: {
  title: string;
  lead: string;
  points: ReactNode[];
}) {
  return (
    <div className="flex flex-col gap-3.5">
      <Panel className="p-4 sm:p-6">
        <PanelHead
          icon={<IconMusic color="#d2a06a" />}
          tint="bg-amber-t"
          title={title}
          aside={<span className="text-[12.5px] text-mute">TikTok</span>}
        />
        <div className="mt-4">
          <Empty>{lead}</Empty>
        </div>
        <div className="mt-4 rounded-[16px] border border-line2 bg-sub/60 p-4">
          <p className="text-[12.5px] font-semibold text-soft">Что появится здесь после подключения:</p>
          <ul className="mt-2 flex flex-col gap-1.5">
            {points.map((p, i) => (
              <li key={i} className="flex items-start gap-2 text-[12px] leading-relaxed text-mute">
                <span className="mt-[6px] h-1 w-1 shrink-0 rounded-full bg-amber" />
                <span>{p}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[11px] leading-relaxed text-dim">
            Для запуска нужен доступ к TikTok Business (Marketing API): app id/secret и токен
            рекламного кабинета. Дай их — подключу так же, как Facebook.
          </p>
        </div>
      </Panel>
    </div>
  );
}
