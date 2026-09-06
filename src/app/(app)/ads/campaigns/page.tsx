import { requireUser } from '@/lib/auth';
import { Panel, PanelHead, Sub } from '@/components/ui';
import { IconRocket, IconWarn } from '@/components/icons';

/**
 * Кампании — раздел рекламного пространства. Пока заглушка с описанием: сама
 * механика подключается следующими шагами, но место в интерфейсе уже занято,
 * чтобы переключатель вёл не в пустоту.
 */
export default async function AdsPage() {
  await requireUser();
  return (
    <div className="flex flex-col gap-3.5">
      <Panel className="p-4 sm:p-6">
        <PanelHead icon={<IconRocket color="#b4c68c" />} tint="bg-sage-t" title="Кампании" aside={<span className="text-[12.5px] text-mute">на подключении</span>} />
        <p className="mt-4 text-[12.5px] leading-relaxed text-soft">Список кампаний, адсетов и объявлений с метриками — лиды, клики, показы, CTR, CPL, расход. Сортировка и фильтр по кабинету и баеру, кнопки пауза и запуск, правка бюджета. Готовим подключение к Marketing API.</p>
        <Sub className="mt-4 flex gap-3 px-4 py-3.5">
          <span className="mt-0.5 shrink-0"><IconWarn color="#d2a06a" size={16} /></span>
          <span className="text-[12px] leading-relaxed text-mute">Читалка метрик заведётся на текущем токене. Для пауз и запуска нужен токен с доступом на управление рекламой — проверим при подключении.</span>
        </Sub>
      </Panel>
    </div>
  );
}
