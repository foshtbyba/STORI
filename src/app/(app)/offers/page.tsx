import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { canSeeTeam, type Role } from '@/lib/roles';
import { parseGeos, OFFER_STATUS } from '@/lib/format';
import { saveOffer, deleteOffer } from '@/app/actions/catalog';
import { Panel, Empty } from '@/components/ui';
import Select from '@/components/Select';
import { IconDown, IconPlus } from '@/components/icons';

export default async function OffersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; new?: string }>;
}) {
  const user = await requireUser();
  const team = canSeeTeam(user.role as Role);
  const { status, new: creating } = await searchParams;

  const offers = await prisma.offer.findMany({
    where: status && OFFER_STATUS[status] ? { status } : {},
    orderBy: [{ status: 'asc' }, { name: 'asc' }],
  });
  const counts = await prisma.offer.groupBy({ by: ['status'], _count: true });
  const total = counts.reduce((a, c) => a + c._count, 0);

  return (
    <div className="flex flex-col gap-3.5">
      <Panel className="flex h-[68px] items-center gap-6 px-5">
        <div className="flex items-center gap-2.5">
          <a
            href="/offers"
            className={`rounded-full px-4 py-2 text-[13px] ${!status ? 'bg-raise font-semibold' : 'bg-sub text-mute'}`}
          >
            Все · {total}
          </a>
          {Object.entries(OFFER_STATUS).map(([code, meta]) => {
            const count = counts.find((c) => c.status === code)?._count ?? 0;
            return (
              <a
                key={code}
                href={`/offers?status=${code}`}
                className={`rounded-full px-4 py-2 text-[13px] ${status === code ? 'bg-raise font-semibold' : 'bg-sub text-mute'}`}
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
            className="flex items-center gap-2 rounded-full bg-sage px-4 py-2.5 text-[13px] font-semibold text-bg"
          >
            <IconPlus color="#141414" size={13} width={2.8} />
            Оффер
          </a>
        ) : null}
      </Panel>

      {creating && team ? (
        <form action={saveOffer} className="grid grid-cols-3 gap-3 rounded-[26px] border border-line bg-panel p-6">
          <input name="name" required placeholder="Название" className="rounded-[18px] bg-sub px-4 py-3 text-[14px] outline-none" />
          <input name="vertical" placeholder="Вертикаль · тема" className="rounded-[18px] bg-sub px-4 py-3 text-[14px] outline-none" />
          <input name="network" placeholder="Партнёрка" className="rounded-[18px] bg-sub px-4 py-3 text-[14px] outline-none" />
          <input name="geos" placeholder="Гео через запятую: IT, ES, PT" className="rounded-[18px] bg-sub px-4 py-3 text-[14px] outline-none" />
          <input name="bans" placeholder="Исключения через запятую" className="rounded-[18px] bg-sub px-4 py-3 text-[14px] outline-none" />
          <input name="previewUrl" placeholder="Ссылка на превью" className="rounded-[18px] bg-sub px-4 py-3 text-[14px] outline-none" />
          <textarea name="notes" rows={2} placeholder="Уточнения, по одному в строке" className="col-span-2 resize-y rounded-[18px] bg-sub px-4 py-3 text-[14px] outline-none" />
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <Select
                name="status"
                defaultValue="ACTIVE"
                options={Object.entries(OFFER_STATUS).map(([code, meta]) => ({
                  value: code,
                  label: meta.label,
                }))}
              />
            </div>
            <button type="submit" className="rounded-full bg-sage px-5 py-3 text-[13px] font-semibold text-bg">
              Сохранить
            </button>
          </div>
        </form>
      ) : null}

      {offers.length === 0 ? (
        <Empty>Офферов пока нет.</Empty>
      ) : (
        <div className="grid grid-cols-3 gap-3.5">
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
                  <div className="mt-3 flex items-center justify-between">
                    <span className="text-[11.5px] text-mute">
                      обновлено {offer.updatedAt.toISOString().slice(8, 10)}.{offer.updatedAt.toISOString().slice(5, 7)}
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
