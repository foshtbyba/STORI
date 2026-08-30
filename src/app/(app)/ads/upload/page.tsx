import { requireUser } from '@/lib/auth';
import { Panel, PanelHead, Sub } from '@/components/ui';
import { IconTag, IconWarn } from '@/components/icons';

/**
 * Автозалив — раздел рекламного пространства. Пока заглушка с описанием: сама
 * механика подключается следующими шагами, но место в интерфейсе уже занято,
 * чтобы переключатель вёл не в пустоту.
 */
export default async function AdsPage() {
  await requireUser();
  return (
    <div className="flex flex-col gap-3.5">
      <Panel className="p-4 sm:p-6">
        <PanelHead icon={<IconTag color="#b4c68c" />} tint="bg-sage-t" title="Автозалив" aside={<span className="text-[12.5px] text-mute">на подключении</span>} />
        <p className="mt-4 text-[12.5px] leading-relaxed text-soft">Заливка кампаний в Facebook по шаблонам: гео, лендинг, бекфикс и креативы берутся из карточек офферов, которые уже заведены в «Офферах». Кампания, адсет, объявление и загрузка медиа — одной кнопкой.</p>
        <Sub className="mt-4 flex gap-3 px-4 py-3.5">
          <span className="mt-0.5 shrink-0"><IconWarn color="#d2a06a" size={16} /></span>
          <span className="text-[12px] leading-relaxed text-mute">Самый крупный шаг, идёт после мониторинга кампаний: у Меты жёсткие лимиты на массовую заливку, поэтому нужна аккуратная очередь и статусы модерации у каждого объявления.</span>
        </Sub>
      </Panel>
    </div>
  );
}
