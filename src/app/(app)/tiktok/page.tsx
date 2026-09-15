import { requireUser } from '@/lib/auth';
import TiktokSoon from '@/components/TiktokSoon';

/** Обзор TikTok — зеркало FB-обзора, пока заглушка до подключения API. */
export default async function TiktokOverviewPage() {
  await requireUser();
  return (
    <TiktokSoon
      title="Обзор TikTok"
      lead="Раздел TikTok готов по структуре, данные подтянутся после подключения кабинета."
      points={[
        'Сводка по расходу и результатам рекламных кабинетов TikTok за неделю.',
        'ROI по кампаниям с расходом из TikTok и конверсиями из Keitaro.',
        'Быстрый статус кабинетов: активные, на модерации, забаненные.',
      ]}
    />
  );
}
