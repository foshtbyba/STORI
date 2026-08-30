import { requireAdmin } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { fmtDay } from '@/lib/period';
import { deleteToken, toggleToken, toggleAccount, linkGroup } from '@/app/actions/integrations';
import { SYNC_DAYS } from '@/lib/sync';
import { Panel, PanelHead, Sub, Empty, Avatar } from '@/components/ui';
import { TokenForm, TrackerForm, SyncNow } from '@/components/IntegrationForms';
import { IconWallet, IconLink, IconChart, IconWarn } from '@/components/icons';

/**
 * Настройка источников цифр: расход из Facebook, доход из Keitaro.
 *
 * Страница только для админа — под этими ключами лежит доступ к кабинетам и к
 * трекеру всей команды.
 */
export default async function IntegrationsPage() {
  await requireAdmin();

  const [tokens, tracker, groups, buyers] = await Promise.all([
    prisma.adToken.findMany({
      include: {
        buyer: { select: { id: true, handle: true, initials: true, color: true } },
        accounts: { orderBy: { name: 'asc' } },
      },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.tracker.findFirst(),
    prisma.trackerGroup.findMany({
      include: { buyer: { select: { handle: true } } },
      orderBy: { name: 'asc' },
    }),
    prisma.buyer.findMany({
      where: { archived: false },
      select: { id: true, handle: true },
      orderBy: { handle: 'asc' },
    }),
  ]);

  const unlinked = groups.filter((g) => !g.buyerId).length;

  return (
    <div className="flex flex-col gap-3.5">
      <Panel className="p-4 sm:p-6">
        <PanelHead
          icon={<IconLink color="#b4c68c" />}
          tint="bg-sage-t"
          title="Источники цифр"
          aside={
            <span className="text-[12.5px] text-mute">
              последние {SYNC_DAYS} дня перетягиваются заново
            </span>
          }
          right={<SyncNow />}
        />
        <p className="mt-4 text-[12px] leading-relaxed text-mute">
          Доход приходит из Keitaro и ложится в отчёты дня. Реальный расход — с Brocard
          (фактические списания с карт); Facebook тянется отдельно и только для справки, в
          зарплату он не идёт. Синхронизация никогда не спорит с человеком: поправленную руками
          цифру в отчёте она не трогает и отмечает такую строку отдельно.
        </p>
      </Panel>

      {/* ── Facebook ──────────────────────────────────────────────────── */}
      <Panel className="p-4 sm:p-6">
        <PanelHead
          icon={<IconWallet color="#b4c68c" />}
          tint="bg-sage-t"
          title="Рекламные кабинеты"
          aside={<span className="text-[12.5px] text-mute">Facebook · для справки</span>}
        />

        {tokens.length === 0 ? (
          <Empty>Токенов пока нет — добавь первый ниже.</Empty>
        ) : (
          tokens.map((token) => (
            <div key={token.id} className="mt-4 border-t border-line pt-4">
              <div className="flex flex-wrap items-center gap-3">
                <Avatar initials={token.buyer.initials} color={token.buyer.color} />
                <span className="min-w-0 flex-1">
                  <span className="block text-[14.5px] font-semibold">
                    {token.buyer.handle}
                    <span className="ml-2 text-[12px] font-normal text-mute">{token.label}</span>
                  </span>
                  <span className="block text-[11.5px] text-mute">
                    {token.lastSyncAt ? `последний заход ${fmtDay(token.lastSyncAt)}` : 'ещё не ходили'}
                    {' · '}
                    кабинетов {token.accounts.length}
                  </span>
                </span>
                <form action={toggleToken}>
                  <input type="hidden" name="id" value={token.id} />
                  <button
                    type="submit"
                    className={`rounded-full px-3.5 py-1.5 text-[12px] transition ${
                      token.enabled ? 'bg-sage-t text-sage' : 'bg-sub text-mute'
                    }`}
                  >
                    {token.enabled ? 'включён' : 'выключен'}
                  </button>
                </form>
                <form action={deleteToken}>
                  <input type="hidden" name="id" value={token.id} />
                  <button type="submit" className="px-1 text-[13px] text-dim transition hover:text-rust">
                    ✕
                  </button>
                </form>
              </div>

              {token.lastError ? (
                <Sub className="mt-2.5 px-3.5 py-2.5 text-[12px] leading-relaxed text-rust">
                  {token.lastError}
                </Sub>
              ) : null}

              <div className="mt-3 flex flex-wrap gap-1.5">
                {token.accounts.map((acc) => (
                  <form key={acc.id} action={toggleAccount}>
                    <input type="hidden" name="id" value={acc.id} />
                    <button
                      type="submit"
                      title={acc.externalId}
                      className={`rounded-full px-3 py-1.5 text-[11.5px] transition ${
                        acc.enabled ? 'bg-sub text-soft hover:text-text' : 'bg-sub text-dim line-through'
                      }`}
                    >
                      {acc.name || acc.externalId}
                      {acc.currency !== 'USD' ? (
                        <span className="ml-1.5 text-rust">{acc.currency}</span>
                      ) : null}
                    </button>
                  </form>
                ))}
                {token.accounts.length === 0 ? (
                  <span className="text-[12px] text-mute">под этим токеном кабинетов не видно</span>
                ) : null}
              </div>
            </div>
          ))
        )}

        <div className="mt-5 border-t border-line pt-4">
          <div className="text-[12.5px] font-semibold">Добавить токен</div>
          <p className="mt-1.5 text-[11.5px] leading-relaxed text-mute">
            Подойдёт плоский токен или мультитокен из антидетекта — из него сам достанется ключ.
            Расход отсюда информативный: настоящий берётся с Brocard. Facebook нужен, чтобы позже
            включить мониторинг и управление кампаниями прямо тут.
          </p>
          <TokenForm buyers={buyers} />
        </div>
      </Panel>

      {/* ── Keitaro ───────────────────────────────────────────────────── */}
      <Panel className="p-4 sm:p-6">
        <PanelHead
          icon={<IconChart color="#b4c68c" />}
          tint="bg-sage-t"
          title="Keitaro"
          aside={<span className="text-[12.5px] text-mute">доход</span>}
          right={
            tracker?.lastSyncAt ? (
              <span className="text-[12px] text-mute">
                последний заход {fmtDay(tracker.lastSyncAt)}
              </span>
            ) : null
          }
        />

        {tracker?.lastError ? (
          <Sub className="mt-3 px-3.5 py-2.5 text-[12px] leading-relaxed text-rust">
            {tracker.lastError}
          </Sub>
        ) : null}

        <TrackerForm baseUrl={tracker?.baseUrl ?? ''} hasKey={Boolean(tracker?.apiKey)} />

        <div className="mt-5 border-t border-line pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[12.5px] font-semibold">Группы кампаний</span>
            {unlinked ? (
              <span className="flex items-center gap-2 text-[12px] text-rust">
                <IconWarn color="#ce6e58" size={14} />
                без баера: {unlinked}
              </span>
            ) : null}
          </div>
          <p className="mt-1.5 text-[11.5px] leading-relaxed text-mute">
            Доход делится по группам: группа — это баер. Пока группа не привязана, её доход никуда
            не записывается и показывается отдельной строкой в отчёте о синхронизации — молча
            терять деньги нельзя.
          </p>

          {groups.length === 0 ? (
            <Empty>Групп пока не видно — сохрани ключ выше, и они подтянутся.</Empty>
          ) : (
            <div className="mt-3 flex flex-col gap-2">
              {groups.map((g) => (
                <form
                  key={g.id}
                  action={linkGroup}
                  className="flex flex-wrap items-center gap-2.5 rounded-[16px] bg-sub px-3.5 py-2.5"
                >
                  <input type="hidden" name="id" value={g.id} />
                  <span className="min-w-0 flex-1 truncate text-[13px]">
                    {g.name}
                    <span className="ml-2 text-[11px] text-dim">#{g.externalId}</span>
                  </span>
                  <select
                    name="buyerId"
                    defaultValue={g.buyerId ?? ''}
                    className="h-9 rounded-xl border border-line2 bg-panel px-3 text-[12.5px] text-text outline-none focus:border-sage"
                  >
                    <option value="">— не привязана —</option>
                    {buyers.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.handle}
                      </option>
                    ))}
                  </select>
                  <button
                    type="submit"
                    className="rounded-full border border-line2 px-3.5 py-1.5 text-[12px] text-soft transition hover:border-sage hover:text-sage"
                  >
                    Сохранить
                  </button>
                </form>
              ))}
            </div>
          )}
        </div>
      </Panel>
    </div>
  );
}
