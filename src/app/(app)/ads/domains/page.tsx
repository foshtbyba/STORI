import { requireUser, scopeBuyerId } from '@/lib/auth';
import { canSeeTeam, type Role } from '@/lib/roles';
import { prisma } from '@/lib/db';
import { fmtWhen } from '@/lib/period';
import { usd } from '@/lib/money';
import { Panel, PanelHead, Empty } from '@/components/ui';
import { IconLink, IconTag } from '@/components/icons';
import Storefront, { type ZoneGroup, type SoldRow, type BuyerOpt } from '@/components/Storefront';
import { setZonePrice, uploadDomains, setBuyerDomainGroup } from '@/app/actions/domains';

/**
 * Магазин доменов. Админ грузит зарегистрированные домены на склад и задаёт
 * цену по зонам; баер покупает свободный — расход падает ему в расходники
 * (категория «Домены»), а домен в Keitaro переезжает в его доменную группу.
 */
export default async function DomainsPage() {
  const user = await requireUser();
  const role = user.role as Role;
  const admin = role === 'ADMIN';
  const team = canSeeTeam(role);
  const scoped = scopeBuyerId(user);

  const [available, prices, soldRaw, buyers] = await Promise.all([
    prisma.domain.findMany({ where: { status: 'available' }, orderBy: { name: 'asc' } }),
    prisma.domainZonePrice.findMany(),
    prisma.domain.findMany({
      where: { status: 'sold', ...(team ? {} : { buyerId: scoped ?? '__none__' }) },
      include: { buyer: { select: { id: true, handle: true } } },
      orderBy: { soldAt: 'desc' },
    }),
    prisma.buyer.findMany({
      where: { archived: false, owner: false },
      select: { id: true, handle: true, ktDomainGroupId: true },
      orderBy: { handle: 'asc' },
    }),
  ]);

  const priceByZone = new Map(prices.map((p) => [p.zone, p.priceCents]));

  // Свободные — по зонам, с ценой зоны.
  const byZone = new Map<string, ZoneGroup>();
  for (const d of available) {
    const g = byZone.get(d.zone) ?? { zone: d.zone, priceCents: priceByZone.get(d.zone) ?? null, domains: [] };
    g.domains.push({ id: d.id, name: d.name });
    byZone.set(d.zone, g);
  }
  const zones = [...byZone.values()].sort((a, b) => a.zone.localeCompare(b.zone));
  const freeCount = available.length;

  const sold: SoldRow[] = soldRaw.map((d) => ({
    id: d.id,
    name: d.name,
    buyerHandle: d.buyer?.handle ?? '—',
    priceLabel: d.priceCents != null ? usd(d.priceCents) : '—',
    ktMoved: d.ktMoved,
    ktError: d.ktError,
    soldAt: d.soldAt ? fmtWhen(d.soldAt) : null,
    mine: d.buyerId === user.buyer?.id,
  }));

  const buyerOpts: BuyerOpt[] = buyers.map((b) => ({ id: b.id, handle: b.handle }));
  const canBuy = admin ? buyerOpts.length > 0 : !!user.buyer;

  // Зоны, по которым уже есть домены, но цена не задана — подсветим в редакторе.
  const zonesInStock = [...new Set(available.map((d) => d.zone))].sort();

  return (
    <div className="flex flex-col gap-3.5">
      <Panel className="p-4 sm:p-6">
        <PanelHead
          icon={<IconLink color="#b4c68c" />}
          tint="bg-sage-t"
          title="Магазин доменов"
          aside={<span className="text-[12.5px] text-mute">{freeCount} свободно · {sold.length} куплено</span>}
        />
        <div className="mt-4">
          {freeCount === 0 && sold.length === 0 ? (
            <Empty>{admin ? 'Склад пуст — загрузи домены ниже.' : 'Свободных доменов пока нет.'}</Empty>
          ) : (
            <Storefront zones={zones} sold={sold} buyers={buyerOpts} admin={admin} canBuy={canBuy} />
          )}
        </div>
        <p className="mt-4 text-[11px] leading-relaxed text-dim">
          Покупка сразу пишет расход баеру в «Расходники» (категория «Домены») и переносит домен в
          его доменную группу Keitaro. Если группа у баера не задана — покупка пройдёт, а перенос
          отметится как пропущенный (см. столбец «КТ»).
        </p>
      </Panel>

      {team ? (
        <Panel className="p-4 sm:p-6">
          <PanelHead icon={<IconTag color="#d2a06a" />} tint="bg-amber-t" title="Цены по зонам" />
          <p className="mt-2 text-[11.5px] leading-relaxed text-mute">
            Цена задаётся на доменную зону (TLD). Пустая цена — убрать зону из прайса.
          </p>
          <div className="mt-3 flex flex-col gap-2">
            {[...new Set([...zonesInStock, ...prices.map((p) => p.zone)])].sort().map((zone) => {
              const cur = priceByZone.get(zone);
              const missing = zonesInStock.includes(zone) && cur == null;
              return (
                <form key={zone} action={setZonePrice} className="flex flex-wrap items-center gap-2 text-[12.5px]">
                  <input type="hidden" name="zone" value={zone} />
                  <span className={`w-20 font-medium ${missing ? 'text-rust' : ''}`}>.{zone}</span>
                  <div className="flex items-center gap-1">
                    <span className="text-mute">$</span>
                    <input
                      name="price"
                      defaultValue={cur != null ? (cur / 100).toFixed(2) : ''}
                      inputMode="decimal"
                      placeholder="5.00"
                      className="w-24 rounded-lg border border-line2 bg-sub px-2.5 py-1.5 text-soft"
                    />
                  </div>
                  <button type="submit" className="rounded-full border border-line2 bg-sub px-3 py-1.5 text-[12px] text-soft transition hover:border-sage hover:text-sage">
                    сохранить
                  </button>
                  {missing ? <span className="text-[11px] text-rust">есть домены без цены</span> : null}
                </form>
              );
            })}
            {/* Добавить зону, которой ещё нет на складе. */}
            <form action={setZonePrice} className="mt-1 flex flex-wrap items-center gap-2 border-t border-line pt-3 text-[12.5px]">
              <input name="zone" placeholder="напр. com" className="w-24 rounded-lg border border-line2 bg-sub px-2.5 py-1.5 text-soft" />
              <div className="flex items-center gap-1">
                <span className="text-mute">$</span>
                <input name="price" inputMode="decimal" placeholder="5.00" className="w-24 rounded-lg border border-line2 bg-sub px-2.5 py-1.5 text-soft" />
              </div>
              <button type="submit" className="rounded-full border border-line2 bg-sub px-3 py-1.5 text-[12px] text-soft transition hover:border-sage hover:text-sage">
                добавить зону
              </button>
            </form>
          </div>
        </Panel>
      ) : null}

      {admin ? (
        <>
          <Panel className="p-4 sm:p-6">
            <PanelHead icon={<IconLink color="#d2a06a" />} tint="bg-amber-t" title="Загрузить домены на склад" />
            <form action={uploadDomains} className="mt-3 flex flex-col gap-2.5">
              <textarea
                name="domains"
                rows={5}
                placeholder={'по одному в строке или через запятую:\nexample.com\nmy-site.net'}
                className="w-full rounded-xl border border-line2 bg-sub px-3 py-2.5 text-[12.5px] text-soft"
              />
              <div>
                <button type="submit" className="rounded-full border border-line2 bg-sub px-4 py-1.5 text-[12px] text-soft transition hover:border-sage hover:text-sage">
                  Добавить на склад
                </button>
              </div>
              <p className="text-[11px] leading-relaxed text-dim">
                Схему (https://), www и путь уберём сами; дубли и уже проданные не тронем. Домены
                должны быть заранее заведены в самом Keitaro (в группе-складе) — при покупке мы их
                там находим по имени и переносим в группу баера.
              </p>
            </form>
          </Panel>

          <Panel className="p-4 sm:p-6">
            <PanelHead icon={<IconTag color="#b4c68c" />} tint="bg-sage-t" title="Доменные группы баеров в Keitaro" />
            <p className="mt-2 text-[11.5px] leading-relaxed text-mute">
              id доменной группы баера в КТ — куда переносим купленный домен со склада. Пусто —
              перенос пропускаем (покупка и расход всё равно проходят).
            </p>
            <div className="mt-3 flex flex-col gap-2">
              {buyers.map((b) => (
                <form key={b.id} action={setBuyerDomainGroup} className="flex flex-wrap items-center gap-2 text-[12.5px]">
                  <input type="hidden" name="buyerId" value={b.id} />
                  <span className="w-28 font-medium">{b.handle}</span>
                  <input
                    name="groupId"
                    defaultValue={b.ktDomainGroupId}
                    placeholder="id группы в КТ"
                    className="w-40 rounded-lg border border-line2 bg-sub px-2.5 py-1.5 text-soft"
                  />
                  <button type="submit" className="rounded-full border border-line2 bg-sub px-3 py-1.5 text-[12px] text-soft transition hover:border-sage hover:text-sage">
                    сохранить
                  </button>
                </form>
              ))}
            </div>
          </Panel>
        </>
      ) : null}
    </div>
  );
}
