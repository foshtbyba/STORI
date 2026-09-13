import { requireUser, scopeBuyerId } from '@/lib/auth';
import { canSeeTeam, type Role } from '@/lib/roles';
import { prisma } from '@/lib/db';
import { fmtWhen } from '@/lib/period';
import { usd } from '@/lib/money';
import { Panel, PanelHead, Empty } from '@/components/ui';
import { IconLink, IconTag } from '@/components/icons';
import Storefront, { type ZoneGroup, type SoldRow, type BuyerOpt } from '@/components/Storefront';
import PullStock from '@/components/PullStock';
import Collapsible from '@/components/Collapsible';
import { setZonePrice, setBuyerDomainGroup, setStockGroup } from '@/app/actions/domains';
import { syncStockFromKeitaro, DEFAULT_ZONE_PRICE_CENTS } from '@/lib/domain-stock';

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

  // Авто-подтяжка склада из Keitaro при заходе на витрину: домены появляются
  // в товарах сами (с троттлингом внутри, чтобы не долбить КТ). Мягко — на
  // сбое КТ страница всё равно откроется.
  await syncStockFromKeitaro(false);

  const [available, prices, soldRaw, buyers] = await Promise.all([
    prisma.domain.findMany({ where: { status: 'available' }, orderBy: { name: 'asc' } }),
    prisma.domainZonePrice.findMany(),
    prisma.domain.findMany({
      where: { status: 'sold', ...(team ? {} : { buyerId: scoped ?? '__none__' }) },
      include: { buyer: { select: { id: true, handle: true } } },
      orderBy: { soldAt: 'desc' },
    }),
    prisma.buyer.findMany({
      // И баеры, и овнеры (SKO/MPR): у каждого своя доменная группа в КТ и на
      // них тоже можно покупать домены.
      where: { archived: false },
      select: { id: true, handle: true, ktDomainGroupId: true },
      orderBy: [{ owner: 'desc' }, { handle: 'asc' }],
    }),
  ]);

  const stockGroup = admin
    ? (await prisma.setting.findUnique({ where: { key: 'kt_domain_stock_group' } }))?.value ?? ''
    : '';

  const priceByZone = new Map(prices.map((p) => [p.zone, p.priceCents]));

  // Свободные — по зонам, ТОЛЬКО наличие и цена. Имена доменов до покупки не
  // отдаём в браузер вовсе.
  const byZone = new Map<string, ZoneGroup>();
  for (const d of available) {
    // Нет своей цены — продаём по умолчанию за $7, а не блокируем зону.
    const g = byZone.get(d.zone) ?? { zone: d.zone, priceCents: priceByZone.get(d.zone) ?? DEFAULT_ZONE_PRICE_CENTS, count: 0 };
    g.count += 1;
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
            <Empty>{admin ? 'Склад пуст — жми «Подтянуть со склада КТ» ниже.' : 'Свободных доменов пока нет.'}</Empty>
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

      {/* Настройки магазина — тремя компактными плашками в одну строку. */}
      {team ? (
        <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-3 lg:gap-3.5">
          {/* Цены по зонам — сворачиваемая. */}
          <Collapsible
            title="Цены по зонам"
            icon={<IconTag color="#d2a06a" />}
            tint="bg-amber-t"
            summary={
              <p className="text-[11.5px] leading-relaxed text-mute">
                Цена задаётся на доменную зону (TLD). Без своей цены зона продаётся по умолчанию за
                ${(DEFAULT_ZONE_PRICE_CENTS / 100).toFixed(0)}.
              </p>
            }
          >
            <div className="flex flex-col gap-2">
              {[...new Set([...zonesInStock, ...prices.map((p) => p.zone)])].sort().map((zone) => {
                const cur = priceByZone.get(zone);
                const usingDefault = cur == null;
                return (
                  <form key={zone} action={setZonePrice} className="flex flex-wrap items-center gap-2 text-[12.5px]">
                    <input type="hidden" name="zone" value={zone} />
                    <span className="w-16 font-medium">.{zone}</span>
                    <div className="flex items-center gap-1">
                      <span className="text-mute">$</span>
                      <input
                        name="price"
                        defaultValue={cur != null ? (cur / 100).toFixed(2) : ''}
                        inputMode="decimal"
                        placeholder={(DEFAULT_ZONE_PRICE_CENTS / 100).toFixed(2)}
                        className="w-20 rounded-lg border border-line2 bg-sub px-2.5 py-1.5 text-soft"
                      />
                    </div>
                    <button type="submit" className="rounded-full border border-line2 bg-sub px-3 py-1.5 text-[12px] text-soft transition hover:border-sage hover:text-sage">
                      сохранить
                    </button>
                    {usingDefault ? <span className="text-[11px] text-mute">по умолч. ${(DEFAULT_ZONE_PRICE_CENTS / 100).toFixed(0)}</span> : null}
                  </form>
                );
              })}
              {/* Добавить зону, которой ещё нет на складе. */}
              <form action={setZonePrice} className="mt-1 flex flex-wrap items-center gap-2 border-t border-line pt-3 text-[12.5px]">
                <input name="zone" placeholder="напр. com" className="w-20 rounded-lg border border-line2 bg-sub px-2.5 py-1.5 text-soft" />
                <div className="flex items-center gap-1">
                  <span className="text-mute">$</span>
                  <input name="price" inputMode="decimal" placeholder="5.00" className="w-20 rounded-lg border border-line2 bg-sub px-2.5 py-1.5 text-soft" />
                </div>
                <button type="submit" className="rounded-full border border-line2 bg-sub px-3 py-1.5 text-[12px] text-soft transition hover:border-sage hover:text-sage">
                  добавить
                </button>
              </form>
            </div>
          </Collapsible>

          {/* Доменные группы — сворачиваемая. */}
          {admin ? (
            <Collapsible
              title="Доменные группы в Keitaro"
              icon={<IconTag color="#b4c68c" />}
              tint="bg-sage-t"
              summary={
                <p className="text-[11.5px] leading-relaxed text-mute">
                  id группы-склада и доменной группы каждого баера. Смотри в Keitaro: Домены →
                  группы, колонка ID. Пусто у баера — перенос пропускаем.
                </p>
              }
            >
              <form action={setStockGroup} className="mt-3 flex flex-wrap items-center gap-2 rounded-[14px] border border-line px-3 py-2.5 text-[12.5px]">
                <span className="w-24 font-medium text-amber">Склад</span>
                <input
                  name="groupId"
                  defaultValue={stockGroup}
                  placeholder="напр. 17"
                  className="w-24 rounded-lg border border-line2 bg-sub px-2.5 py-1.5 text-soft"
                />
                <button type="submit" className="rounded-full border border-line2 bg-sub px-3 py-1.5 text-[12px] text-soft transition hover:border-sage hover:text-sage">
                  сохранить
                </button>
              </form>
              <div className="mt-3 flex flex-col gap-2">
                {buyers.map((b) => (
                  <form key={b.id} action={setBuyerDomainGroup} className="flex flex-wrap items-center gap-2 text-[12.5px]">
                    <input type="hidden" name="buyerId" value={b.id} />
                    <span className="w-24 font-medium">{b.handle}</span>
                    <input
                      name="groupId"
                      defaultValue={b.ktDomainGroupId}
                      placeholder="id в КТ"
                      className="w-24 rounded-lg border border-line2 bg-sub px-2.5 py-1.5 text-soft"
                    />
                    <button type="submit" className="rounded-full border border-line2 bg-sub px-3 py-1.5 text-[12px] text-soft transition hover:border-sage hover:text-sage">
                      сохранить
                    </button>
                  </form>
                ))}
              </div>
            </Collapsible>
          ) : null}

          {/* Склад доменов — крайняя правая плитка. */}
          {admin ? (
            <Panel className="p-4 sm:p-6">
              <PanelHead
                icon={<IconLink color="#d2a06a" />}
                tint="bg-amber-t"
                title="Склад доменов"
                right={<PullStock />}
              />
              <p className="mt-3 text-[11.5px] leading-relaxed text-mute">
                Домены берём прямо из группы-склада Keitaro (id склада — в плитке «Доменные
                группы»). Заводишь домены в КТ в группе-складе, жмёшь «Подтянуть со склада КТ» —
                появляются на витрине свободными. Дубли и уже проданные не трогаем.
              </p>
            </Panel>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
