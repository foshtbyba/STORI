import { requireUser } from '@/lib/auth';
import TiktokSoon from '@/components/TiktokSoon';

/** Автозалив TikTok — зеркало FB-автозалива, пока заглушка до подключения API. */
export default async function TiktokUploadPage() {
  await requireUser();
  return (
    <TiktokSoon
      title="Автозалив TikTok"
      lead="Автозалив роликов в TikTok будет здесь — по той же логике, что и Facebook."
      points={[
        'Создание кампании → группы → объявления по шаблону гео одним нажатием.',
        'Загрузка роликов в кабинет TikTok, таргет по гео/возрасту/языку.',
        'Режимы запуска (пауза/актив/расписание), очередь и журнал заливов.',
      ]}
    />
  );
}
