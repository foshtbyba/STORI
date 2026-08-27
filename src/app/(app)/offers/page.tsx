import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { canSeeTeam, type Role } from '@/lib/roles';
import { parseGeos, OFFER_STATUS } from '@/lib/format';
import { saveOffer, deleteOffer } from '@/app/actions/catalog';
import { builderPayload, builderGaps, partnerOf } from '@/lib/builder';
import { Panel, Empty } from '@/components/ui';
import OfferForm, { type OfferDraft } from '@/components/OfferForm';
import CopyOffer from '@/components/CopyOffer';
import { IconDown, IconPlus } from '@/components/icons';

export default async function OffersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; new?: string; edit?: string }>;
}) {
  const user = await requireUser();
  const team = canSeeTeam(user.role as Role);
  const { status, new: creating, edit } = await searchParams;

  const offers = await prisma.offer.findMany({
    where: status && OFFER_STATUS[status] ? { status } : {},
    orderBy: [{ status: 'asc' }, { name: 'asc' }],
  });
  const editing = edit ? await prisma.offer.findUnique({ where: { id: edit } }) : null;
  const counts = await prisma.offer.groupBy({ by: ['status'], _count: true });
  const total = counts.reduce((a, c) => a + c._count, 0);

  return (
    <div className="flex flex-col gap-3.5">
      <Panel className="flex flex-wrap items-center gap-3 px-4 py-3 sm:h-[68px] sm:flex-nowrap sm:gap-6 sm:px-5 sm:py-0">
        <div className="no-scrollbar -mx-1 flex min-w-0 flex-1 items-center gap-2 overflow-x-auto px-1 sm:gap-2.5">
          <a
            href="/offers"
            className={`shrink-0 whitespace-nowrap rounded-full px-4 py-2 text-[13px] ${!status ? 'bg-raise font-semibold' : 'bg-sub text-mute'}`}
          >
            Все · {total}
          </a>
          {Object.entries(OFFER_STATUS).map(([code, meta]) => {
            const count = counts.find((c) => c.status === code)?._count ?? 0;
            return (
              <a
                key={code}
                href={`/offers?status=${code}`}
                className={`shrink-0 whitespace-nowrap rounded-full px-4 py-2 text-[13px] ${status === code ? 'bg-raise font-semibold' : 'bg-sub text-mute'}`}
              >
                {meta.label} · {count}
              </a>
            );
          })}
        </div>
        <div className="flex-1" />
        {team ? (
          <a
            href="/offers?new=1"
            className="flex shrink-0 items-center gap-2 rounded-full bg-sage px-4 py-2.5 text-[13px] font-semibold text-bg"
          >
            <IconPlus color="#141414" size={13} width={2.8} />
            Оффер
          </a>
        ) : null}
      </Panel>

      {(creating || edit) && team ? (
        <OfferForm
          action={saveOffer}
          statuses={Object.entries(OFFER_STATUS).map(([code, meta]) => ({
            value: code,
            label: meta.label,
          }))}
          draft={draftFor(editing)}
        />
      ) : null}

      {offers.length === 0 ? (
        <Empty>Офферов пока нет.</Empty>
      ) : (
        <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-3 lg:gap-3.5">
          {offers.map((offer) => {
            const meta = OFFER_STATUS[offer.status] ?? OFFER_STATUS.TEST;
            return (
              <Panel key={offer.id} className="flex flex-col gap-4 p-3.5">
                <div className="relative flex h-[168px] items-center justify-center rounded-[18px] bg-sub">
                  {offer.previewUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={offer.previewUrl} alt="" className="h-full w-full rounded-[18px] object-cover" />
                  ) : (
                    <span className="text-[11.5px] text-mute">превью не загружено</span>
                  )}
                  <span
                    className="absolute left-3 top-3 flex items-center gap-2 rounded-full px-3 py-1.5 text-[11.5px] font-semibold"
                    style={{ background: meta.tint, color: meta.color }}
                  >
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: meta.color }} />
                    {meta.label}
                  </span>
                  {offer.previewUrl ? (
                    <a
                      href={offer.previewUrl}
                      download
                      className="absolute bottom-3 right-3 flex items-center gap-2 rounded-full border border-line2 bg-panel px-3.5 py-2 text-[12px] font-semibold"
                    >
                      <IconDown size={13} width={2.1} />
                      Скачать
                    </a>
                  ) : null}
                </div>

                <div className="px-1.5">
                  <div className="text-[21px] font-bold tracking-[-0.02em]">{offer.name}</div>
                  <div className="mt-1.5 text-[12.5px] text-mute">
                    {[offer.vertical, offer.network].filter(Boolean).join(' · ') || '—'}
                  </div>
                </div>

                <div className="rounded-[18px] bg-sub px-4 py-3.5">
                  <div className="lab mb-2.5">Доступные гео</div>
                  <div className="flex flex-wrap gap-1.5">
                    {parseGeos(offer.geosJson).map((geo) => (
                      <span key={geo} className="n rounded-full bg-raise px-3 py-1 text-[12px]">{geo}</span>
                    ))}
                    {parseGeos(offer.geosJson).length === 0 ? <span className="text-[12px] text-mute">не указаны</span> : null}
                  </div>
                </div>

                <div className="rounded-[18px] bg-sub px-4 py-3.5">
                  <div className="lab mb-2.5 text-rust">Исключения</div>
                  <div className="flex flex-wrap gap-1.5">
                    {parseGeos(offer.bansJson).map((ban) => (
                      <span key={ban} className="rounded-full bg-rust-t px-3 py-1 text-[12px] text-rust">{ban}</span>
                    ))}
                    {parseGeos(offer.bansJson).length === 0 ? <span className="text-[12px] text-mute">нет</span> : null}
                  </div>
                </div>

                <div className="flex-1" />
                <div className="px-1.5 pb-1">
                  {parseGeos(offer.notesJson).map((note) => (
                    <div key={note} className="mb-2 flex gap-2.5">
                      <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-mute" />
                      <span className="text-[12.5px] leading-relaxed text-soft">{note}</span>
                    </div>
                  ))}
                  {/* Данные для конструктора: одной кнопкой в буфер, оттуда — в билдер. */}
                  {team ? (
                    <div className="mt-3 flex items-start gap-2 border-t border-line pt-3.5">
                      <CopyOffer
                        payload={builderPayload({
                          name: offer.name,
                          partnerKey: offer.partnerKey,
                          offerId: offer.offerId,
                          langCode: offer.langCode,
                          landingUrl: offer.landingUrl,
                          streamCode: offer.streamCode,
                          price: offer.price,
                          imagePath: offer.imagePath,
                          backfix: offer.backfix,
                          uiLang: offer.uiLang,
                        })}
                        gaps={builderGaps({
                          name: offer.name,
                          partnerKey: offer.partnerKey,
                          offerId: offer.offerId,
                          langCode: offer.langCode,
                          landingUrl: offer.landingUrl,
                          streamCode: offer.streamCode,
                          price: offer.price,
                          imagePath: offer.imagePath,
                          backfix: offer.backfix,
                          uiLang: offer.uiLang,
                        })}
                      />
                      <a
                        href={`/offers?edit=${offer.id}`}
                        className="shrink-0 rounded-full border border-line px-4 py-2 text-[12.5px] text-mute transition hover:border-line2 hover:text-soft"
                      >
                        Править
                      </a>
                    </div>
                  ) : null}

                  <div className="mt-3 flex items-center justify-between">
                    <span className="text-[11.5px] text-mute">
                      {partnerOf(offer.partnerKey)?.label ?? 'партнёрка не выбрана'} · обновлено{' '}
                      {offer.updatedAt.toISOString().slice(8, 10)}.{offer.updatedAt.toISOString().slice(5, 7)}
                    </span>
                    {team ? (
                      <form action={deleteOffer}>
                        <input type="hidden" name="id" value={offer.id} />
                        <button type="submit" className="text-[11.5px] text-mute transition hover:text-rust">
                          удалить
                        </button>
                      </form>
                    ) : null}
                  </div>
                </div>
              </Panel>
            );
          })}
        </div>
      )}
    </div>
  );
}

type OfferRow = Awaited<ReturnType<typeof prisma.offer.findMany>>[number];

/** Строка из базы → черновик формы: списки разворачиваем обратно в строку. */
function draftFor(o: OfferRow | null): OfferDraft {
  return {
    id: o?.id,
    name: o?.name ?? '',
    vertical: o?.vertical ?? '',
    network: o?.network ?? '',
    status: o?.status ?? 'ACTIVE',
    geos: parseGeos(o?.geosJson ?? '[]').join(', '),
    bans: parseGeos(o?.bansJson ?? '[]').join(', '),
    notes: parseGeos(o?.notesJson ?? '[]').join('\n'),
    previewUrl: o?.previewUrl ?? '',
    payout: o?.payout ?? '',
    partnerKey: o?.partnerKey ?? '',
    offerId: o?.offerId ?? '',
    landingUrl: o?.landingUrl ?? '',
    streamCode: o?.streamCode ?? '',
    langCode: o?.langCode ?? '',
    price: o?.price ?? '',
    imagePath: o?.imagePath ?? '',
    backfix: o?.backfix ?? '',
    uiLang: o?.uiLang ?? '',
  };
}
