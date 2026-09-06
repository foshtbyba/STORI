import { requireUser, scopeBuyerId } from '@/lib/auth';
import { canSeeTeam, type Role } from '@/lib/roles';
import { prisma } from '@/lib/db';
import { fmtDay, weekBounds, weekKey } from '@/lib/period';
import { usd } from '@/lib/money';
import { Panel, PanelHead, Sub, Empty, Avatar } from '@/components/ui';
import ConfirmSubmit from '@/components/ConfirmSubmit';
import { MyTokenForm, TokenForm } from '@/components/IntegrationForms';
import { deleteMyToken, deleteToken, toggleToken, toggleAccount } from '@/app/actions/integrations';
import { IconRocket, IconWallet, IconTag, IconChart } from '@/components/icons';

/**
 * Обзор рекламного пространства — техничка ФБ.
 *
 * Кабинеты живут здесь целиком: и витрина подключённого, и подключение нового.
 * Раньше команду админ заводил на отдельной вкладке в «Статистике», а баер —
 * тут: одно и то же дело в двух местах, и каждый раз надо было вспоминать, в
 * каком. Ключи от Brocard и Keitaro остались в админке — их трогают раз в
 * жизни, а кабинеты смотрят каждый день.
 */
export default async function AdsOverviewPage() {
  const user = await requireUser();
  const role = user.role as Role;
  const team = canSeeTeam(role);
  const admin = role === 'ADMIN';
  const scoped = scopeBuyerId(user);

  const [tokens, buyers] = await Promise.all([
    prisma.adToken.findMany({
      where: team ? {} : { buyerId: scoped ?? '__none__' },
      include: {
        buyer: { select: { handle: true, initials: true, color: true } },
        accounts: { orderBy: { name: 'asc' } },
      },
      orderBy: { createdAt: 'asc' },
    }),
    // Список баеров нужен только админской форме — остальным её не показываем.
    admin
      ? prisma.buyer.findMany({
          where: { archived: false },
          select: { id: true, handle: true },
          orderBy: { handle: 'asc' },
        })
      : Promise.resolve([]),
  ]);

  // Справочный расход за текущую неделю по кабинетам.
  const { from, to } = weekBounds(weekKey(new Date()));
  const spend = await prisma.adAccountDay.groupBy({
    by: ['accountId'],
    where: { date: { gte: from, lt: to } },
    _sum: { spendCents: true },
  });
  const spendByAccount = new Map(spend.map((s) => [s.accountId, s._sum.spendCents ?? 0]));

  const cabinets = tokens.reduce((n, t) => n + t.accounts.length, 0);

  return (
    <div className="flex flex-col gap-3.5">
      <Panel className="p-4 sm:p-6">
        <PanelHead
          icon={<IconRocket color="#b4c68c" />}
          tint="bg-sage-t"
          title="Реклама"
          aside={<span className="text-[12.5px] text-mute">техничка Facebook</span>}
        />
        <p className="mt-4 text-[12px] leading-relaxed text-mute">
          Здесь всё про рекламу: подключённые кабинеты, а дальше — мониторинг кампаний (лиды, клики,
          CTR), включение и выключение объявлений и автозалив. Расход отсюда справочный — реальный
          считается по Brocard в «Статистике».
        </p>
      </Panel>

      <Panel className="p-4 sm:p-6">
        <PanelHead
          icon={<IconWallet color="#b4c68c" />}
          tint="bg-sage-t"
          title="Подключённые кабинеты"
          aside={<span className="text-[12.5px] text-mute">{cabinets} кабинетов</span>}
        />
        {tokens.length === 0 ? (
          <div className="mt-4">
            <Empty>Кабинеты ещё не подключены — добавь первый ниже.</Empty>
          </div>
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
                    {token.lastSyncAt ? `обновлено ${fmtDay(token.lastSyncAt)}` : 'ещё не синхронизировано'}
                    {' · '}
                    кабинетов {token.accounts.length}
                    {token.proxyUrl ? (
                      <span className="ml-2 rounded-full bg-steel-t px-2 py-0.5 text-[10px] text-steel">
                        через прокси
                      </span>
                    ) : null}
                  </span>
                </span>

                {/* Включение и снятие чужого токена — только у админа. */}
                {admin ? (
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
                ) : (
                  <span className="text-[12px] text-mute">{token.enabled ? 'включён' : 'выключен'}</span>
                )}

                {admin ? (
                  <form action={deleteToken}>
                    <input type="hidden" name="id" value={token.id} />
                    <ConfirmSubmit
                      className="px-1 text-[13px] text-dim transition hover:text-rust"
                      armedClassName="!text-rust font-semibold"
                      title="Отвязать токен"
                    >
                      ✕
                    </ConfirmSubmit>
                  </form>
                ) : user.buyer && token.buyerId === user.buyer.id ? (
                  /* Свой токен баер снимает сам. */
                  <form action={deleteMyToken}>
                    <input type="hidden" name="id" value={token.id} />
                    <button
                      type="submit"
                      className="px-1 text-[13px] text-dim transition hover:text-rust"
                      title="Отвязать"
                    >
                      ✕
                    </button>
                  </form>
                ) : null}
              </div>

              {token.lastError ? (
                <Sub className="mt-2.5 px-3.5 py-2.5 text-[12px] leading-relaxed text-rust">
                  {token.lastError}
                </Sub>
              ) : null}

              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {token.accounts.map((acc) => {
                  const money = (
                    <span className="n ml-2 shrink-0 text-[12.5px] text-mute">
                      {usd(spendByAccount.get(acc.id) ?? 0)}
                    </span>
                  );
                  // Админ может выключить кабинет из синхронизации кликом прямо
                  // по плитке — отдельная кнопка рядом с каждой из них только
                  // засорила бы сетку.
                  return admin ? (
                    <form key={acc.id} action={toggleAccount}>
                      <input type="hidden" name="id" value={acc.id} />
                      <button
                        type="submit"
                        className="w-full text-left"
                        title={
                          acc.enabled
                            ? `${acc.externalId} · выключить из синхронизации`
                            : `${acc.externalId} · включить`
                        }
                      >
                        <Sub className="flex items-center justify-between px-3.5 py-2.5 transition hover:bg-raise">
                          <span
                            className={`min-w-0 truncate text-[12.5px] ${
                              acc.enabled ? 'text-soft' : 'text-dim line-through'
                            }`}
                          >
                            {acc.name || acc.externalId}
                            {acc.currency !== 'USD' ? (
                              <span className="ml-1.5 text-rust">{acc.currency}</span>
                            ) : null}
                          </span>
                          {money}
                        </Sub>
                      </button>
                    </form>
                  ) : (
                    <Sub key={acc.id} className="flex items-center justify-between px-3.5 py-2.5">
                      <span className="min-w-0 truncate text-[12.5px] text-soft" title={acc.externalId}>
                        {acc.name || acc.externalId}
                      </span>
                      {money}
                    </Sub>
                  );
                })}
                {token.accounts.length === 0 ? (
                  <span className="text-[12px] text-mute">кабинетов под токеном не видно</span>
                ) : null}
              </div>
            </div>
          ))
        )}
        <p className="mt-4 text-[11px] leading-relaxed text-dim">
          Цифра рядом с кабинетом — расход из ФБ за текущую неделю, для справки. В зарплату идёт
          расход с Brocard.
        </p>

        <div className="mt-5 border-t border-line pt-4">
          {admin ? (
            <>
              <div className="text-[12.5px] font-semibold">Добавить кабинет</div>
              <p className="mt-1.5 text-[11.5px] leading-relaxed text-mute">
                Два входа на выбор: готовый токен (плоский или мультитокен из антидетекта) либо куки
                аккаунта — ключ из них достанется сам. Прокси задаётся тут же и дальше используется
                на каждом запросе к Facebook. Расход отсюда информативный: настоящий берётся с
                Brocard.
              </p>
              <TokenForm buyers={buyers} />
            </>
          ) : user.buyer ? (
            <>
              <div className="text-[12.5px] font-semibold">Подключить свой кабинет</div>
              <p className="mt-1.5 text-[11.5px] leading-relaxed text-mute">
                Токен из Facebook или мультитокен из антидетекта. Всё, что видно под ним, — твои
                кабинеты; расход отсюда справочный.
              </p>
              <MyTokenForm />
            </>
          ) : (
            <div className="text-[11.5px] text-mute">
              Кабинеты подключает админ — у аккаунта нет профиля баера.
            </div>
          )}
        </div>
      </Panel>

      <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-2 lg:gap-3.5">
        <Panel className="p-4 sm:p-6">
          <PanelHead icon={<IconChart color="#b4c68c" />} tint="bg-sage-t" title="Кампании" />
          <p className="mt-3 text-[12px] leading-relaxed text-mute">
            Таблица кампаний с метриками — лиды, клики, CTR, расход — и кнопками пауза/запуск. На
            подключении.
          </p>
        </Panel>
        <Panel className="p-4 sm:p-6">
          <PanelHead icon={<IconTag color="#b4c68c" />} tint="bg-sage-t" title="Автозалив" />
          <p className="mt-3 text-[12px] leading-relaxed text-mute">
            Заливка кампаний по шаблонам из карточек офферов. Следующий большой шаг после мониторинга.
          </p>
        </Panel>
      </div>
    </div>
  );
}
