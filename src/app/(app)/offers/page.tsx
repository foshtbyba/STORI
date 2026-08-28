import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { canSeeTeam, type Role } from '@/lib/roles';
import { parseGeos, OFFER_STATUS } from '@/lib/format';
import { saveOffer, deleteOffer, uploadOfferFiles, deleteOfferFile } from '@/app/actions/catalog';
import { builderPayload, builderGaps, partnerOf, DEFAULT_BACKFIX } from '@/lib/builder';
import { Panel, Empty } from '@/components/ui';
import OfferForm, { type OfferDraft } from '@/components/OfferForm';
import CopyOffer from '@/components/CopyOffer';
import OfferFiles from '@/components/OfferFiles';
import DeleteOffer from '@/components/DeleteOffer';
import { IconPlus } from '@/components/icons';

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
    include: {
      geos: { orderBy: { sort: 'asc' } },
      files: { select: { id: true, name: true, size: true, mime: true, kind: true }, orderBy: { createdAt: 'asc' } },
    },
  });
  const editing = edit
    ? await prisma.offer.findUnique({ where: { id: edit }, include: { geos: { orderBy: { sort: 'asc' } } } })
    : null;
  const counts = await prisma.offer.groupBy({ by: ['status'], _count: true });
  const total = counts.reduce((a, c) => a + c._count, 0);

  return (
    <div className="flex flex-col gap-3.5">
      <Panel className="flex flex-wrap items-center gap-3 px-4 py-3 sm:h-[68px] sm:flex-nowrap sm:gap-6 sm:px-5 sm:py-0">
        <div className="no-scrollbar flex basis-full items-center gap-2 overflow-x-auto sm:min-w-0 sm:basis-auto sm:flex-1 sm:gap-2.5">
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
        <div className="hidden flex-1 sm:block" />
        {team ? (
          <a
            href="/offers?new=1"
            className="flex w-full shrink-0 items-center justify-center gap-2 rounded-full bg-sage px-4 py-2.5 text-[13px] font-semibold text-bg sm:w-auto"
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
            const previewFile = offer.files.find((f) => f.kind === 'PREVIEW') ?? null;
            const reviews = offer.files.filter((f) => f.kind === 'REVIEW');
            // Загруженный файл важнее ссылки: ссылок на превью обычно нет вовсе.
            const previewSrc = previewFile ? `/api/offer-file/${previewFile.id}` : offer.previewUrl;
            return (
              <Panel key={offer.id} className="flex flex-col gap-4 p-3.5">
                <div className="relative flex h-[168px] items-center justify-center overflow-hidden rounded-[18px] bg-sub">
                  {previewSrc ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={previewSrc} alt="" className="h-full w-full object-cover" />
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
                </div>

                <div className="px-1.5">
                  <div className="text-[21px] font-bold tracking-[-0.02em]">{offer.name}</div>
                  {/* Партнёрку видит только команда: баеру знать, у кого стоит
                      оффер, незачем — он льёт, а не договаривается. */}
                  <div className="mt-1.5 text-[12.5px] text-mute">
                    {[offer.vertical, team ? offer.network : ''].filter(Boolean).join(' · ') || '—'}
                  </div>
                  {offer.payout ? (
                    <span className="mt-2.5 inline-flex items-center gap-2 rounded-full bg-sage-t px-3 py-1.5">
                      <span className="lab text-sage">за продажу</span>
                      <span className="n text-[13.5px] font-semibold text-sage">{offer.payout}</span>
                    </span>
                  ) : null}
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
                  <div className="lab mb-2.5 text-rust">Регионы-исключения</div>
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
                  {/* Данные для конструктора: гео на выбор — под каждое своё. */}
                  {team ? (
                    <>
                      <div className="mt-3 flex items-start gap-2 border-t border-line pt-3.5">
                        <CopyOffer
                          geos={offer.geos.map((g) => {
                            const one = {
                              name: offer.name,
                              partnerKey: offer.partnerKey,
                              backfix: offer.backfix,
                              langCode: g.langCode,
                              uiLang: g.uiLang,
                              partnerOfferId: g.partnerOfferId,
                              landingUrl: g.landingUrl,
                              streamCode: g.streamCode,
                              price: g.price,
                            };
                            return {
                              langCode: g.langCode,
                              payload: builderPayload(one),
                              gaps: builderGaps(one),
                            };
                          })}
                        />
                        <a
                          href={`/offers?edit=${offer.id}`}
                          className="shrink-0 rounded-full border border-line px-4 py-2 text-[12.5px] text-mute transition hover:border-line2 hover:text-soft"
                        >
                          Править
                        </a>
                      </div>

                      <OfferFiles
                        offerId={offer.id}
                        preview={previewFile}
                        reviews={reviews}
                        upload={uploadOfferFiles}
                        remove={deleteOfferFile}
                      />
                    </>
                  ) : null}

                  <div className="mt-3 flex items-center justify-between gap-3">
                    <span className="text-[11.5px] text-mute">
                      {team
                        ? `${partnerOf(offer.partnerKey)?.label ?? 'партнёрка не выбрана'} · обновлено `
                        : 'обновлено '}
                      {offer.updatedAt.toISOString().slice(8, 10)}.{offer.updatedAt.toISOString().slice(5, 7)}
                    </span>
                    {team ? <DeleteOffer id={offer.id} name={offer.name} action={deleteOffer} /> : null}
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

type OfferRow = NonNullable<
  Awaited<ReturnType<typeof prisma.offer.findUnique>>
> & { geos: { langCode: string; uiLang: string; partnerOfferId: string; landingUrl: string; streamCode: string; price: string }[] };

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
    backfix: o?.backfix ?? DEFAULT_BACKFIX,
    rows: (o?.geos ?? []).map((g) => ({
      langCode: g.langCode,
      uiLang: g.uiLang,
      partnerOfferId: g.partnerOfferId,
      landingUrl: g.landingUrl,
      streamCode: g.streamCode,
      price: g.price,
    })),
  };
}
