import { requireUser, scopeBuyerId } from '@/lib/auth';
import { canSeeTeam, type Role } from '@/lib/roles';
import { prisma } from '@/lib/db';
import { fmtWhen, weekBounds, weekKey } from '@/lib/period';
import { usd } from '@/lib/money';
import { tiktokConfigured, tiktokAuthUrl, signTiktokState } from '@/lib/tiktok';
import { Panel, PanelHead, Empty } from '@/components/ui';
import TiktokTokenCard, { type TiktokTokenView } from '@/components/TiktokTokenCard';
import CopyConnectLink from '@/components/CopyConnectLink';
import { IconRocket } from '@/components/icons';

/** Деньги кабинета: USD как $, прочее — округляем и локализуем. */
function money(cents: number, currency: string): string {
  return currency === 'USD' ? usd(cents) : `${Math.round(cents / 100).toLocaleString('ru-RU')} ${currency}`;
}

const DEAD = new Set(['STATUS_DISABLE', 'STATUS_CONFIRM_FAIL', 'STATUS_PUNISH', 'STATUS_LIMIT']);

/**
 * Обзор TikTok — зеркало FB-обзора. Подключение кабинетов идёт через
 * официальный Marketing API (OAuth): баер жмёт «Подключить», авторизует
 * приложение на своём кабинете, дальше расход/статусы тянем по токену.
 */
export default async function TiktokOverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; err?: string; noaccounts?: string; already?: string }>;
}) {
  const user = await requireUser();
  const team = canSeeTeam(user.role as Role);
  const scoped = scopeBuyerId(user);
  const sp = await searchParams;

  const tokens = await prisma.tiktokToken.findMany({
    where: team ? {} : { buyerId: scoped ?? '__none__' },
    include: {
      buyer: { select: { id: true, handle: true } },
      accounts: { orderBy: { name: 'asc' } },
    },
    orderBy: { createdAt: 'asc' },
  });

  // Расход за текущую неделю по кабинетам.
  const { from, to } = weekBounds(weekKey(new Date()));
  const spend = await prisma.tiktokAccountDay.groupBy({
    by: ['accountId'],
    where: { date: { gte: from, lt: to } },
    _sum: { spendCents: true },
  });
  const spendByAccount = new Map(spend.map((s) => [s.accountId, s._sum.spendCents ?? 0]));

  const views: TiktokTokenView[] = tokens.map((t) => ({
    id: t.id,
    label: t.label,
    handle: t.buyer.handle,
    status: t.status,
    error: t.lastError,
    updated: t.lastSyncAt ? fmtWhen(t.lastSyncAt) : null,
    canManage: team || Boolean(user.buyer && t.buyerId === user.buyer.id),
    accounts: t.accounts.map((a) => ({
      id: a.id,
      advertiserId: a.advertiserId,
      name: a.name,
      currency: a.currency,
      status: a.status,
      statusReason: a.statusReason,
      balance: money(a.balanceCents, a.currency),
      spend: money(spendByAccount.get(a.id) ?? 0, a.currency),
      dead: DEAD.has(a.status),
    })),
  }));

  const totalCabinets = tokens.reduce((n, t) => n + t.accounts.length, 0);
  const configured = tiktokConfigured();
  const canConnect = Boolean(user.buyer);
  // Одна ссылка подключения на баера: открывается по очереди в разных
  // антидетект-профилях, каждый раз привязывая тот кабинет, что залогинен там.
  const connectUrl = configured && user.buyer ? tiktokAuthUrl(signTiktokState(user.buyer.id)) : '';

  return (
    <div className="flex flex-col gap-3.5">
      <Panel className="p-4 sm:p-6">
        <PanelHead
          icon={<IconRocket color="#b4c68c" />}
          tint="bg-sage-t"
          title="Обзор TikTok"
          aside={<span className="text-[12.5px] text-mute">{tokens.length} подключений · {totalCabinets} кабинетов</span>}
        />

        {/* Результат подключения из редиректа. */}
        {sp.connected ? (
          <div className="mt-4 rounded-[12px] border border-sage/40 bg-sage-t px-3 py-2.5 text-[12px] text-sage">
            TikTok подключён — добавлено кабинетов: {sp.connected}.
          </div>
        ) : null}
        {sp.already ? (
          <div className="mt-4 rounded-[12px] border border-amber/40 bg-amber-t px-3 py-2.5 text-[12px] text-amber">
            Этот кабинет уже подключён — ничего не добавили.
          </div>
        ) : null}
        {sp.noaccounts ? (
          <div className="mt-4 rounded-[12px] border border-amber/40 bg-amber-t px-3 py-2.5 text-[12px] text-amber">
            В этом браузере не залогинен ни один рекламный кабинет TikTok — открой ссылку в профиле с нужным кабинетом.
          </div>
        ) : null}
        {sp.err ? (
          <div className="mt-4 rounded-[12px] border px-3 py-2.5 text-[12px] text-rust" style={{ borderColor: '#5a2a2a' }}>
            {sp.err === 'nobuyer' ? 'У аккаунта нет профиля баера — подключать кабинеты не с чем.'
              : sp.err === 'noapp' ? 'Приложение TikTok не настроено на сервере (нет app_id/secret/redirect).'
              : sp.err === 'state' ? 'Сессия подключения не совпала (CSRF) — попробуй ещё раз.'
              : sp.err === 'nocode' ? 'TikTok не вернул код авторизации — попробуй ещё раз.'
              : `Не удалось подключить: ${decodeURIComponent(sp.err)}`}
          </div>
        ) : null}

        <div className="mt-4">
          {tokens.length === 0 ? (
            <Empty>TikTok-кабинеты ещё не подключены — нажми «Подключить TikTok».</Empty>
          ) : (
            views.map((t) => <TiktokTokenCard key={t.id} token={t} />)
          )}
        </div>

        <div className="mt-5 border-t border-line pt-4">
          {!canConnect ? (
            <p className="text-[11.5px] text-mute">У аккаунта нет профиля баера — подключать кабинеты не с чем.</p>
          ) : (
            <div>
              <div className="text-[12.5px] font-semibold">Подключить TikTok</div>
              <p className="mt-1.5 text-[11.5px] leading-relaxed text-mute">
                Всё через официальный TikTok Marketing API — данные, прокси и антидетект вводить не нужно.
                Нажми кнопку (подключит кабинет из текущего браузера) <span className="text-soft">или</span> скопируй ссылку и
                открой её по очереди в каждом антидетект-профиле — каждый раз привяжется тот кабинет, что залогинен в этом
                браузере. Одной ссылкой можно подключить сколько угодно кабинетов.
              </p>

              {configured ? (
                <>
                  <a href="/api/tiktok/auth" className="mt-3 inline-flex rounded-full border border-sage bg-sage-t px-5 py-2 text-[12.5px] font-semibold text-sage transition hover:brightness-110">
                    Подключить кабинет из этого браузера
                  </a>
                  <div className="mt-3 text-[11.5px] font-medium text-soft">Ссылка для подключения (многоразовая):</div>
                  <CopyConnectLink url={connectUrl} />
                </>
              ) : (
                <>
                  <span className="mt-3 inline-flex cursor-not-allowed rounded-full border border-line2 px-5 py-2 text-[12.5px] font-semibold text-dim opacity-60" title="Сначала настрой приложение TikTok">
                    Подключить TikTok
                  </span>
                  <div className="mt-3 rounded-[12px] border border-amber/40 bg-amber-t px-3 py-2.5 text-[11.5px] leading-relaxed text-amber">
                    Кнопка появится, когда подключим наше приложение TikTok. Нужно один раз (как у shakeads — своё
                    приложение): зарегистрировать приложение в TikTok for Business (Marketing API), в его настройках указать
                    redirect <span className="font-medium">https://наш-домен/api/tiktok/callback</span>, затем прописать на
                    сервере <span className="font-medium">TIKTOK_APP_ID</span>, <span className="font-medium">TIKTOK_APP_SECRET</span> и
                    <span className="font-medium"> TIKTOK_REDIRECT_URI</span>. После этого кнопка и ссылка станут активными.
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </Panel>
    </div>
  );
}
