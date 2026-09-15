import { requireUser } from '@/lib/auth';
import TiktokSoon from '@/components/TiktokSoon';

/** Кампании TikTok — зеркало FB-кампаний, пока заглушка до подключения API. */
export default async function TiktokCampaignsPage() {
  await requireUser();
  return (
    <TiktokSoon
      title="Кампании TikTok"
      lead="Таблица кампаний TikTok появится здесь — как в разделе Facebook."
      points={[
        'Таблица кампаний/групп/объявлений с расходом, показами, кликами и конверсиями.',
        'Пауза/запуск и правка бюджета прямо из таблицы через TikTok API.',
        'Поиск, сортировка и сводка по выбранным кабинетам.',
      ]}
    />
  );
}
