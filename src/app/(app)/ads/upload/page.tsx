import { requireUser } from '@/lib/auth';
import { canSeeTeam, type Role } from '@/lib/roles';
import { prisma } from '@/lib/db';
import { Panel, PanelHead, Empty } from '@/components/ui';
import { IconTag, IconRocket } from '@/components/icons';
import AutouploadForm from '@/components/AutouploadForm';
import TemplateManager from '@/components/TemplateManager';
import LanguagePack from '@/components/LanguagePack';
import Collapsible from '@/components/Collapsible';

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
    headline: l.headline,
    primaryText: l.primaryText,
    description: l.description,
    link: l.link,
  }));

  const cabinets = tokens.flatMap((t) =>
    t.accounts.map((a) => ({
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
        {cabinets.length === 0 ? (
          <div className="mt-4"><Empty>Нет подключённых кабинетов — сначала подключи токен в «Аккаунтах».</Empty></div>
        ) : templates.length === 0 ? (
          <div className="mt-4"><Empty>Заведи свой первый шаблон гео ниже — без него заливать не из чего.</Empty></div>
        ) : (
          <div className="mt-4">
            <AutouploadForm cabinets={cabinets} templates={templates} languages={languages} />
          </div>
        )}
      </Panel>

      {/* Личные шаблоны гео — доступны каждому, у каждого свои. */}
      <Collapsible
        icon={<IconTag color="#d2a06a" />}
        tint="bg-amber-t"
        title="Мои шаблоны гео"
        defaultOpen={templates.length === 0}
        summary={<span className="text-[12.5px] text-mute">{templates.length} шт. · только твои</span>}
      >
        <div className="mt-1">
          <TemplateManager templates={templates} />
        </div>
      </Collapsible>

      {/* Личный пак языков — для метода «Видео + языки». */}
      <Collapsible
        icon={<IconTag color="#d2a06a" />}
        tint="bg-amber-t"
        title="Мои языки (для видео)"
        summary={<span className="text-[12.5px] text-mute">{languages.length} шт. · добавляются к каждому видео-заливу</span>}
      >
        <div className="mt-1">
          <LanguagePack languages={languages} />
        </div>
      </Collapsible>
    </div>
  );
}
