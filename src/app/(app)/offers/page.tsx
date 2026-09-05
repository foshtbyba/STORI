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
import Link from 'next/link';
import OfferSearch from '@/components/OfferSearch';
import Clamp from '@/components/Clamp';
import CopyExclusions, { type ExclusionGroup } from '@/components/CopyExclusions';

export default async function OffersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; new?: string; edit?: string; q?: string }>;
}) {
  const user = await requireUser();
  const team = canSeeTeam(user.role as Role);
  const { status, new: creating, edit, q } = await searchParams;
  const query = (q ?? '').trim();

  const all = await prisma.offer.findMany({
    orderBy: [{ status: 'asc' }, { name: 'asc' }],
    include: {
      geos: { orderBy: { sort: 'asc' } },
      files: { select: { id: true, name: true, size: true, mime: true, kind: true }, orderBy: { createdAt: 'asc' } },
    },
  });

  /*
    Поиск фильтруем в памяти, а не запросом. Офферов десятки, не миллионы, зато
    регистр и раскладка гео перестают иметь значение: SQLite не умеет
    регистронезависимое `contains`, и на базе пришлось бы городить три варианта
    написания. Гео при этом лежат двумя способами — списком в geosJson и
    строками в geos, — ищем в обоих, иначе оффер находился бы через раз.
  */
  const needle = query.toLowerCase();
  const matches = (offer: (typeof all)[number]) =>
    !needle ||
    offer.name.toLowerCase().includes(needle) ||
    (offer.vertical ?? '').toLowerCase().includes(needle) ||
    parseGeos(offer.geosJson).some((g) => g.toLowerCase().includes(needle)) ||
    offer.geos.some((g) => g.langCode.toLowerCase().includes(needle));

  const found = all.filter(matches);
  const offers = status && OFFER_STATUS[status] ? found.filter((o) => o.status === status) : found;

  const editing = edit
    ? await prisma.offer.findUnique({
        where: { id: edit },
        include: {
          geos: { orderBy: { sort: 'asc' } },
          files: { select: { id: true, name: true, kind: true } },
        },
      })
    : null;

  // Счётчики считают найденное: иначе «Активен · 7» при двух карточках на
  // экране выглядит поломкой.
  const counts = Object.keys(OFFER_STATUS).map((code) => ({
    status: code,
    _count: found.filter((o) => o.status === code).length,
  }));
  const total = found.length;
  // Ссылки на статусы не должны терять запрос, а поиск — выбранный статус.
  const keep = (extra: Record<string, string>) => {
    const p = new URLSearchParams();
    if (status) p.set('status', status);
    if (query) p.set('q', query);
    for (const [k, v] of Object.entries(extra)) v ? p.set(k, v) : p.delete(k);
    const s = p.toString();
    return s ? `/offers?${s}` : '/offers';
  };

  return (
    <div className="flex flex-col gap-3.5">
      <Panel className="flex flex-wrap items-center gap-3 px-4 py-3 sm:h-[68px] sm:flex-nowrap sm:gap-6 sm:px-5 sm:py-0">
        <div className="no-scrollbar flex basis-full items-center gap-2 overflow-x-auto sm:min-w-0 sm:basis-auto sm:flex-1 sm:gap-2.5">
          <Link
            href={query ? `/offers?q=${encodeURIComponent(query)}` : '/offers'}
            className={`shrink-0 whitespace-nowrap rounded-full px-4 py-2 text-[13px] ${!status ? 'bg-raise font-semibold' : 'bg-sub text-mute'}`}
          >
            Все · {total}
          </Link>
          {Object.entries(OFFER_STATUS).map(([code, meta]) => {
            const count = counts.find((c) => c.status === code)?._count ?? 0;
            return (
              <Link
                key={code}
                href={keep({ status: code })}
                className={`shrink-0 whitespace-nowrap rounded-full px-4 py-2 text-[13px] ${status === code ? 'bg-raise font-semibold' : 'bg-sub text-mute'}`}
              >
                {meta.label} · {count}
              </Link>
            );
          })}
        </div>
        <div className="hidden flex-1 sm:block" />

        {/*
          Поиск GET-ом (ссылку с запросом видно в адресе), но правая кнопка
          морфится по состоянию: пусто → «Оффер», набираешь → «Поиск», есть
          запрос → «Сбросить».
        */}
        <OfferSearch
          query={query ?? ''}
          status={status}
          canAdd={team}
          newHref={keep({ new: '1' })}
          resetHref={status ? `/offers?status=${status}` : '/offers'}
        />
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
            // Плитка высотой 168 — картинку просим под неё, а не в те четыре
            // тысячи точек, в которых её сняли на телефон.
            // trim=1 — срезаем однотонные поля вокруг товара: без этого превью с
            // широкими полями выглядит вчетверо мельче соседнего, снятого впритык.
            const previewSrc = previewFile
              ? `/api/offer-file/${previewFile.id}?w=560&trim=1`
              : offer.previewUrl;
            // Показываем только непустые списки исключений. Пустая плашка «нет»
            // рядом с заполненной — просто шум, а две пустых подряд занимают
            // треть карточки и не говорят ничего: на такой случай хватает одной
            // строки «исключений нет».
            //
            // Исключения бывают двух сортов: общие на весь оффер и свои у гео —
            // в разных странах у одного товара запрещено разное. В кабинет
            // уезжает сумма того и другого, поэтому склеиваем их здесь, а не
            // заставляем человека держать в голове два списка.
            const boxOf = (
              key: string,
              title: string,
              label: string,
              commonJson: string,
              ownJson: (g: (typeof offer.geos)[number]) => string,
            ) => {
              const common = parseGeos(commonJson);
              const perGeo = offer.geos.map((g) => ({
                langCode: g.langCode,
                own: parseGeos(ownJson(g)),
              }));
              const hasOwn = perGeo.some((g) => g.own.length > 0);

              // Ни у кого своих нет — незачем городить разбивку по гео: список
              // один на всех, и кнопка копирует его сразу.
              const groups: ExclusionGroup[] = hasOwn
                ? perGeo.map((g) => ({
                    langCode: g.langCode,
                    key: g.langCode,
                    // Дубли убираем: общее исключение, повторённое в гео, в
                    // кабинет должно уехать один раз.
                    items: [...new Set([...common, ...g.own])],
                  }))
                : [{ langCode: '', key: '', items: common }];

              return { key, title, label, groups, byGeo: hasOwn };
            };

            const banBoxes = [
              boxOf('bans', 'Регионы-исключения', 'копировать регионы', offer.bansJson, (g) => g.bansJson),
              boxOf('cities', 'Города-исключения', 'копировать города', offer.citiesJson, (g) => g.citiesJson),
            ].filter((box) => box.groups.some((g) => g.items.length > 0));
            return (
              <Panel key={offer.id} className="flex flex-col gap-4 p-3.5">
                <div className="relative flex h-[168px] items-center justify-center overflow-hidden rounded-[18px] bg-sub">
                  {previewSrc ? (
                    <>
                      {/*
                        Товар показываем целиком (object-contain), а не обрезаем
                        по рамке: у превью пропорции какие угодно — от узкой
                        баночки до широкой раскладки с коробкой, — и cover резал
                        как раз то, ради чего превью и смотрят.
                        Пустоту по бокам закрываем размытой копией той же
                        картинки: файл уже в кэше, второй загрузки нет, а дыра в
                        сетке не зияет.
                      */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={previewSrc}
                        alt=""
                        aria-hidden="true"
                        loading="lazy"
                        decoding="async"
                        className="absolute inset-0 h-full w-full scale-110 object-cover opacity-25 blur-xl"
                      />
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={previewSrc}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        className="relative h-full w-full object-contain p-2"
                      />
                    </>
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

                {/*
                  Исключения: регионы и города — своим списком и своей кнопкой.
                  Вводят их через запятую, а кабинет ждёт построчно, и
                  раскладывать это руками в блокноте на каждый запуск — ровно та
                  работа, которую должна делать кнопка.
                */}
                {banBoxes.length === 0 ? (
                  <div className="rounded-[18px] bg-sub px-4 py-3.5 text-[12px] text-mute">
                    Исключений нет
                  </div>
                ) : null}
                {banBoxes.map((box) => (
                  <div key={box.key} className="rounded-[18px] bg-sub px-4 py-3.5">
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <span className="lab text-rust">{box.title}</span>
                      {team ? (
                        <CopyExclusions label={box.label} title={box.title} groups={box.groups} />
                      ) : null}
                    </div>
                    {/*
                      Список свёрнут целиком: исключений бывает под сотню, и
                      развёрнутыми они топят карточку — а читают их редко, чаще
                      просто копируют кнопкой. Короткое исключение внутри —
                      «таблетка», как гео; длинное кладём строкой во всю ширину
                      и с обычными углами, иначе круглые бока вокруг абзаца
                      превращаются в кляксу.
                    */}
                    <Clamp collapsedPx={0} moreLabel="показать исключения">
                      {box.groups.map((group) => (
                        <div key={group.key} className="mb-2 last:mb-0">
                          {/* Заголовок гео — только когда списки правда разные:
                              над единственным общим он был бы шумом. */}
                          {box.byGeo ? (
                            <div className="n mb-1.5 text-[11px] text-dim">
                              {group.key.toUpperCase()}
                            </div>
                          ) : null}
                          <div className="flex flex-wrap gap-1.5">
                            {group.items.map((ban) => (
                              <span
                                key={ban}
                                className={
                                  ban.length > 28
                                    ? 'basis-full rounded-xl bg-rust-t px-3.5 py-2.5 text-[12px] leading-relaxed text-rust'
                                    : 'rounded-full bg-rust-t px-3 py-1 text-[12px] text-rust'
                                }
                              >
                                {ban}
                              </span>
                            ))}
                          </div>
                        </div>
                      ))}
                    </Clamp>
                  </div>
                ))}

                {/*
                  Заметки идут сразу за исключениями, вплотную. Раньше распорка
                  стояла над ними, и на короткой карточке они улетали к самому
                  низу: в соседних карточках одно и то же поле оказывалось на
                  разной высоте. Тянется теперь пустота под заметками — к низу
                  прижат только подвал с кнопками, он и должен быть на одной
                  линии у всех карточек.
                */}
                {parseGeos(offer.notesJson).length ? (
                  <div className="px-1.5">
                    <Clamp collapsedPx={46} moreLabel="показать примечания">
                      {parseGeos(offer.notesJson).map((note) => (
                        <div key={note} className="mb-2 flex gap-2.5">
                          <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-mute" />
                          <span className="text-[12.5px] leading-relaxed text-soft">{note}</span>
                        </div>
                      ))}
                    </Clamp>
                  </div>
                ) : null}

                <div className="flex-1" />
                <div className="px-1.5 pb-1">
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
                          className="shrink-0 rounded-full border border-line2 bg-sub px-4 py-2 text-[12.5px] text-soft transition hover:border-sage hover:text-sage"
                        >
                          Править
                        </a>
                      </div>

                    </>
                  ) : null}

                  {/* Материалы оффера нужны и баеру — скачать может каждый,
                      загрузить и удалить только команда. */}
                  <OfferFiles
                    offerId={offer.id}
                    preview={previewFile}
                    reviews={reviews}
                    canEdit={team}
                    upload={team ? uploadOfferFiles : undefined}
                    remove={team ? deleteOfferFile : undefined}
                  />

                  <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
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
> & {
  geos: {
    langCode: string;
    uiLang: string;
    partnerOfferId: string;
    landingUrl: string;
    streamCode: string;
    price: string;
    bansJson: string;
    citiesJson: string;
  }[];
  files?: { id: string; name: string; kind: string }[];
};

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
    cities: parseGeos(o?.citiesJson ?? '[]').join(', '),
    notes: parseGeos(o?.notesJson ?? '[]').join('\n'),
    previewUrl: o?.previewUrl ?? '',
    previewId: o?.files?.find((f) => f.kind === 'PREVIEW')?.id ?? null,
    previewName: o?.files?.find((f) => f.kind === 'PREVIEW')?.name ?? '',
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
      bans: parseGeos(g.bansJson).join(', '),
      cities: parseGeos(g.citiesJson).join(', '),
    })),
  };
}
