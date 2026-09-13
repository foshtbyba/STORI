import { requireUser } from '@/lib/auth';
import { canSeeTeam, type Role } from '@/lib/roles';
import { prisma } from '@/lib/db';
import { Panel, PanelHead, Sub, Empty } from '@/components/ui';
import { IconTag, IconWarn, IconRocket } from '@/components/icons';
import AutouploadForm from '@/components/AutouploadForm';
import TemplateManager from '@/components/TemplateManager';
import Collapsible from '@/components/Collapsible';

/**
 * Автозалив — сборка кампании в Facebook по шаблону гео. Кабинеты берём из
 * подключённых токенов (админ видит все, баер — свои). Шаблоны гео заводит
 * админ, баер при заливе только выбирает готовый.
 */
export default async function AdsUploadPage() {
  const user = await requireUser();
  const role = user.role as Role;
  const team = canSeeTeam(role);
  const admin = role === 'ADMIN';
  const buyerId = user.buyer?.id ?? '__none__';

  const [tokens, templatesRaw] = await Promise.all([
    prisma.adToken.findMany({
      // Заливать можно только на СВОИ кабинеты. Овнеры/менеджеры (team) —
      // исключительно на овнерские (SKO/MPR); на кабинеты баеров они заливать
      // не должны. Баер — только на свои.
      where: team ? { buyer: { owner: true } } : { buyerId },
      include: {
        buyer: { select: { handle: true, owner: true } },
        accounts: { where: { enabled: true }, orderBy: { name: 'asc' } },
      },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.uploadTemplate.findMany({ where: { archived: false }, orderBy: { name: 'asc' } }),
  ]);

  const cabinets = tokens.flatMap((t) =>
    t.accounts.map((a) => ({
      id: a.id,
      name: a.name,
      externalId: a.externalId,
      currency: a.currency,
      // Группа в выпадашке — по владельцу/профилю, чтобы длинный список читался.
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
          <div className="mt-4">
            <Empty>{admin ? 'Заведи первый шаблон гео ниже — без него заливать не из чего.' : 'Шаблоны гео ещё не заведены — попроси овнера добавить.'}</Empty>
          </div>
        ) : (
          <div className="mt-4">
            <AutouploadForm cabinets={cabinets} templates={templates} />
          </div>
        )}
        <Sub className="mt-4 flex gap-3 px-4 py-3.5">
          <span className="mt-0.5 shrink-0"><IconWarn color="#d2a06a" size={16} /></span>
          <span className="text-[12px] leading-relaxed text-mute">
            По умолчанию всё создаётся на паузе — безопасно. «Сразу в актив» и «по расписанию» запускают
            реальный открут и требуют подтверждения. У Меты жёсткие лимиты на серии создающих запросов,
            поэтому между шагами держим паузы.
          </span>
        </Sub>
      </Panel>

      {admin ? (
        <Collapsible
          icon={<IconTag color="#d2a06a" />}
          tint="bg-amber-t"
          title="Шаблоны гео"
          summary={<span className="text-[12.5px] text-mute">{templates.length} шт. · настраивает админ</span>}
        >
          <div className="mt-1">
            <TemplateManager templates={templates} />
          </div>
        </Collapsible>
      ) : null}
    </div>
  );
}
