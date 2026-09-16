import { requireUser } from '@/lib/auth';
import { canSeeTeam, type Role } from '@/lib/roles';
import { isDeadAccount } from '@/lib/fb-status';
import { prisma } from '@/lib/db';
import { Panel, PanelHead } from '@/components/ui';
import { IconRocket } from '@/components/icons';
import AutouploadForm from '@/components/AutouploadForm';

/**
 * Автозалив — общий инструмент, но у каждого свои заливы и свои шаблоны гео
 * (чужие не показываем). Заливать можно только на свои кабинеты: овнеры/менеджеры
 * — на овнерские (SKO/MPR), баер — на свои. Внутри пока метод «сторис/статика»;
 * видео с языками — отдельным методом позже.
 */
export default async function AdsUploadPage() {
  const user = await requireUser();
  const role = user.role as Role;
  const team = canSeeTeam(role);
  const buyerId = user.buyer?.id ?? '__none__';

  const [tokens, templatesRaw] = await Promise.all([
    prisma.adToken.findMany({
      where: team ? { buyer: { owner: true } } : { buyerId },
      include: {
        buyer: { select: { handle: true, owner: true } },
        accounts: { where: { enabled: true }, orderBy: { name: 'asc' } },
      },
      orderBy: { createdAt: 'asc' },
    }),
    // Личные шаблоны — только свои.
    prisma.uploadTemplate.findMany({ where: { archived: false, userId: user.id }, orderBy: { name: 'asc' } }),
  ]);

  // Личный пак языков для видео-залива.
  const languagesRaw = await prisma.uploadLanguage.findMany({
    where: { archived: false, userId: user.id },
    orderBy: { sort: 'asc' },
  });
  const languages = languagesRaw.map((l) => ({
    id: l.id,
    locale: l.locale,
    videoUrl: l.videoUrl,
    // Байты видео на клиент НЕ шлём — только факт наличия и имя файла.
    hasVideo: Boolean(l.videoData && l.videoData.length),
    videoName: l.videoName,
    headline: l.headline,
    primaryText: l.primaryText,
    description: l.description,
    link: l.link,
  }));

  // Забаненные/закрытые кабинеты в списки выбора (сторис и видео) не выводим —
  // заливать на них нельзя. Критерий «мёртвого» кабинета — общий с синком.
  const cabinets = tokens.flatMap((t) =>
    t.accounts
      .filter((a) => !isDeadAccount(a.accountStatus, a.disableReason))
      .map((a) => ({
        id: a.id,
        name: a.name,
        externalId: a.externalId,
        currency: a.currency,
        group: team ? t.buyer.handle : t.label || t.buyer.handle,
      })),
  );

  const templates = templatesRaw.map((t) => ({
    id: t.id,
    name: t.name,
    countries: t.countries,
    excluded: t.excluded,
    excludedRegions: t.excludedRegions,
    excludedCities: t.excludedCities,
    ageMin: t.ageMin,
    ageMax: t.ageMax,
    genders: t.genders,
    dailyBudgetCents: t.dailyBudgetCents,
    event: t.event,
    cta: t.cta,
    placements: t.placements,
  }));

  return (
    <div className="flex flex-col gap-3.5">
      <Panel className="p-4 sm:p-6">
        <PanelHead
          icon={<IconRocket color="#b4c68c" />}
          tint="bg-sage-t"
          title="Автозалив"
          aside={<span className="text-[12.5px] text-mute">{cabinets.length} кабинетов · {templates.length} шаблонов</span>}
        />
        {/* Форма всегда: вкладки «Шаблоны гео»/«Языки» доступны даже без кабинетов
            и без шаблонов — там их и заводят. */}
        <div className="mt-4">
          <AutouploadForm cabinets={cabinets} templates={templates} languages={languages} admin={role === 'ADMIN'} />
        </div>
      </Panel>

    </div>
  );
}
