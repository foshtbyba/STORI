import 'server-only';
import { prisma } from './db';
import { dayKey } from './period';
import { grossUp, ceilDollars, DEFAULT_COMMISSION_BPS, usd } from './money';
import { AGENCY_SOURCE, AGENCY_COMMISSION_BPS } from './extra-spend';
import { mergeDay } from './sync-rule';
import { accountSpend, listAccounts, listCampaigns as listFbCampaigns, adStats, adMeta, listAdIds, fbAccess, extractFbToken, FbError, fbErrorKind } from './fb';
import { isDeadAccount } from './fb-status';
import { logActivity } from './activity';
import { extractTokenFromCookies } from './fb-engine';
import { humanPause, shuffle, pool, fbCooldownUntil, FB_CONCURRENCY } from './pace';
import { dailyRevenue, revenueByAd, listCampaigns, indexByToken, updateCostsBulk, clearCostsWindow, adCampaignMap, KeitaroError, type CostEntry } from './keitaro';
import { parseKtCandidates } from './kt-link';
import { dailySpend, listTeams, BrocardError } from './brocard';

/**
 * Ошибка про ВЕСЬ токен (её пробрасываем наверх — там кулдаун при троттлинге
 * или обновление ключа из кук) — против ошибки про ОДИН кабинет.
 *
 * Троттлинг/блок/протухший ключ/кончившаяся сессия — это про токен. А «код 100»
 * по конкретному act_ (Object with ID '…' does not exist / missing permissions /
 * Unsupported get request) — это лишь про ЭТОТ кабинет: доступ к нему убрали или
 * его закрыли. Такой не должен ронять весь профиль — просто пропускаем кабинет,
 * остальные под токеном тянутся дальше.
 */
function isTokenLevelError(e: unknown): boolean {
  const k = fbErrorKind(e);
  if (k === 'throttle' || k === 'blocked' || k === 'token') return true;
  if (e instanceof FbError && e.code === 1) return true; // сессия кончилась
  return false;
}

/**
 * Подтягивание цифр из Facebook и Keitaro в отчёты по дням.
 *
 * Главное правило здесь одно: **синхронизация никогда не спорит с человеком**.
 * В строке дня хранится то, что синхронизация записала в прошлый раз. Если
 * текущее значение совпадает с ним — никто не вмешивался, можно обновлять.
 * Если не совпадает — значит цифру поправили руками, и трогать её нельзя: у
 * баера всегда есть причина, которой не знает API.
 *
 * Второе правило: чужой сервер может ответить чем угодно. Любая ошибка
 * записывается в интеграцию и показывается в настройках, но не роняет всю
 * синхронизацию — остальные токены и трекер обрабатываются дальше.
 */

/** Сколько дней перетягиваем за раз. Раз в день переписываем последние две
 *  недели: доход в Keitaro доуточняется по мере подтверждения конверсий, а
 *  тянуть глубже смысла нет — старое уже не меняется. */
export const SYNC_DAYS = 14;

/**
 * Часовой пояс, в котором трекер и кабинеты считают «сутки». Все кабинеты
 * команды в Москве, поэтому и доход, и расход просим в московском времени —
 * иначе день съезжает на три часа и цифры не сходятся с тем, что баер видит у
 * себя. Меняется переменной окружения SYNC_TZ.
 */
export const SYNC_TZ = process.env.SYNC_TZ || 'Europe/Moscow';

type Report = {
  buyerId: string;
  date: Date;
  spendCents?: number;
  revenueCents?: number;
  /** Готовый расход с комиссией — когда источник (Brocard) знает её точно. */
  spendGrossCents?: number;
};

export type SyncResult = {
  /** Сколько строк дней создано или обновлено. */
  touched: number;
  /** Строки, которые не тронули: там ручная правка. */
  skipped: number;
  /** Что пошло не так — по одной строке на источник. */
  problems: string[];
  /** Справочные строки (не ошибки): напр. сводка заливки расхода в КТ. */
  info: string[];
  /** Доход, которому не нашлось баера: группа не привязана. */
  orphanCents: number;
};

const emptyResult = (): SyncResult => ({ touched: 0, skipped: 0, problems: [], info: [], orphanCents: 0 });

/** YYYY-MM-DD для API и полночь UTC для базы — в одном месте, чтобы не разъехались. */
function daysBack(count: number) {
  const to = new Date();
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - (count - 1));
  return { from: dayKey(from), to: dayKey(to) };
}

function atMidnight(iso: string) {
  return new Date(`${iso}T00:00:00.000Z`);
}

/**
 * Глушилка для `.catch(...)` у апдейтов токена: если запись исчезла по ходу
 * захода (P2025 — профиль удалили/пересоздали, пока синк шёл), это не ошибка,
 * обновлять уже нечего. Прочие ошибки пробрасываем как есть.
 */
function ignoreMissing(e: unknown): void {
  if ((e as { code?: string })?.code === 'P2025') return;
  throw e;
}

/**
 * Один и тот же кабинет (act_ID) бывает виден сразу под несколькими профилями —
 * это ДУБЛИ. Если тянуть расход с обоих, он задвоится. Поэтому на каждый
 * externalId выбираем ОДИН «канонический» кабинет и синкаем только его, а дубли
 * пропускаем. Выбираем под самым живым токеном: не на паузе и без ошибки, при
 * равенстве — где синк был позже. Возвращаем id выбранных AdAccount.
 */
type AccForDedup = {
  id: string;
  externalId: string;
  agency: boolean;
  adToken: { pausedUntil: Date | null; lastError: string | null; lastSyncAt: Date | null };
};
function pickCanonicalAccountIds(accs: AccForDedup[], now: Date): Set<string> {
  const best = new Map<string, { id: string; score: number; sync: number }>();
  for (const a of accs) {
    const t = a.adToken;
    const paused = t.pausedUntil && t.pausedUntil > now;
    // Агентский каб выбираем каноническим приоритетно: его пометил человек, и
    // именно с него расход должен уйти в «Агентку». Иначе среди дублей мог
    // выбраться не тот, и агентский расход бы не подтянулся.
    const score = (a.agency ? 100 : 0) + (paused ? 0 : 2) + (t.lastError ? 0 : 1);
    const sync = t.lastSyncAt ? t.lastSyncAt.getTime() : 0;
    const cur = best.get(a.externalId);
    if (!cur || score > cur.score || (score === cur.score && sync > cur.sync)) {
      best.set(a.externalId, { id: a.id, score, sync });
    }
  }
  return new Set([...best.values()].map((v) => v.id));
}

/** Читает все включённые кабинеты со здоровьем их токена и выбирает канонические. */
async function canonicalAccountIds(now: Date): Promise<Set<string>> {
  const accs = await prisma.adAccount.findMany({
    where: { enabled: true },
    select: {
      id: true,
      externalId: true,
      agency: true,
      adToken: { select: { pausedUntil: true, lastError: true, lastSyncAt: true } },
    },
  });
  return pickCanonicalAccountIds(accs, now);
}

/**
 * Запись одного дня. Обновляем только то, что пришло: расход и доход приезжают
 * из разных мест и в разное время, и синхронизация Facebook не должна занулять
 * доход, которого она не видела.
 *
 * Само правило «не спорить с человеком» живёт в sync-rule.ts — отдельно от
 * базы и чужих API, чтобы его можно было прогнать проверкой.
 */
/** Сколько дней назад ещё пересчитывается строка «Агентка» (слепок снимаем на
 *  эту глубину — дальше строки дня уже заморожены). */
const FREEZE_DAYS = 60;

/**
 * ЗАМОРОЗКА агентского расхода токена перед полным удалением аккаунта. Снимаем
 * слепок открута его агентских кабинетов по дням (нетто + с комиссией агента) в
 * AgencyFrozenDay, чтобы строка «Агентка» не просела, когда FbAdDay уедет
 * каскадом. Ключ по externalId: добавят кабинет заново — живой расход заменит
 * слепок (в агрегации слепок по живым externalId не берём). Вызывать ДО delete.
 */
export async function freezeAgencySpend(tokenId: string): Promise<void> {
  const tok = await prisma.adToken.findUnique({ where: { id: tokenId }, select: { buyerId: true } });
  if (!tok) return;
  const accs = await prisma.adAccount.findMany({
    where: { tokenId, agency: true, currency: 'USD' },
    select: { id: true, externalId: true, agent: { select: { commissionBps: true } } },
  });
  if (!accs.length) return;
  const from = new Date();
  from.setUTCHours(0, 0, 0, 0);
  from.setUTCDate(from.getUTCDate() - FREEZE_DAYS);
  for (const acc of accs) {
    const bps = acc.agent?.commissionBps ?? AGENCY_COMMISSION_BPS;
    const byDay = await prisma.fbAdDay.groupBy({
      by: ['date'],
      where: { date: { gte: from }, ad: { adAccountId: acc.id } },
      _sum: { spendCents: true },
    });
    for (const d of byDay) {
      const net = d._sum.spendCents ?? 0;
      if (net <= 0) continue;
      await prisma.agencyFrozenDay.upsert({
        where: { externalId_date: { externalId: acc.externalId, date: d.date } },
        update: { buyerId: tok.buyerId, netCents: net, grossCents: grossUp(net, bps) },
        create: { buyerId: tok.buyerId, externalId: acc.externalId, date: d.date, netCents: net, grossCents: grossUp(net, bps) },
      }).catch(ignoreMissing);
    }
  }
}

/**
 * Автозапись агентского расхода в отчёт дня (строка «Агентка»).
 *
 * Расход агентских кабинетов (флаг agency, оплата мимо карт Brocard) кладём в
 * тот же вид строки, что и ручной ввод: источник «Агентка», комиссия 6%,
 * доход 0 (он на основной строке из Keitaro). Уважаем правки руками: если
 * строку трогали (её spendNetCents ≠ тому, что синк писал в прошлый раз, либо
 * строка вообще ручная — synced пусто, а сумма стоит), не перезаписываем.
 */
async function writeAgencyDay(buyerId: string, iso: string, netCents: number, grossCents: number, result: SyncResult) {
  const date = atMidnight(iso);
  const net = ceilDollars(netCents);
  // Gross уже посчитан по кабинетам (своя ставка у каждого). Не даём ему уйти
  // ниже net (на всякий случай), а эффективную ставку выводим для снапшота.
  const grossFromAccounts = Math.max(grossCents, net);
  const effBps = net > 0 ? Math.round(((grossFromAccounts / net) - 1) * 10000) : AGENCY_COMMISSION_BPS;
  const existing = await prisma.dayReport.findFirst({
    where: { buyerId, date, offerId: null, source: AGENCY_SOURCE },
  });

  if (!existing) {
    if (net <= 0) return;
    await prisma.dayReport.create({
      data: {
        buyerId,
        date,
        offerId: null,
        source: AGENCY_SOURCE,
        revenueCents: 0,
        spendNetCents: net,
        // Ставка — эффективная по агентам кабинетов (у разных агентов свой %).
        commissionBps: effBps,
        spendGrossCents: grossFromAccounts,
        spendSyncedCents: net,
        revenueSyncedCents: null,
        syncedAt: new Date(),
        note: 'агентка автоматически',
      },
    });
    result.touched += 1;
    return;
  }

  // Правили руками — не спорим (как и с обычными строками).
  const touched =
    existing.spendSyncedCents === null
      ? existing.spendNetCents !== 0
      : existing.spendNetCents !== existing.spendSyncedCents;
  if (touched) {
    result.skipped += 1;
    return;
  }
  if (net <= 0) {
    await prisma.dayReport.delete({ where: { id: existing.id } });
    return;
  }
  // Если человек явно назначил ЭТОЙ строке агента в «Доп. расходах» — его % в
  // приоритете (ручной выбор не затираем). Иначе берём эффективную ставку по
  // агентам кабинетов.
  let bps = effBps;
  let gross = grossFromAccounts;
  if (existing.agentId) {
    const agent = await prisma.agent.findUnique({ where: { id: existing.agentId }, select: { commissionBps: true } });
    if (agent) { bps = agent.commissionBps; gross = grossUp(net, bps); }
  }
  await prisma.dayReport.update({
    where: { id: existing.id },
    data: {
      spendNetCents: net,
      commissionBps: bps,
      spendGrossCents: gross,
      spendSyncedCents: net,
      syncedAt: new Date(),
    },
  });
  result.touched += 1;
}

async function writeDay(row: Report, result: SyncResult) {
  const existing = await prisma.dayReport.findFirst({
    where: { buyerId: row.buyerId, date: row.date, offerId: null, source: 'Facebook' },
  });

  if (!existing) {
    // Новой строке нужны оба числа: отчёт без дохода или без расхода в базе
    // смысла не имеет. Чего не знаем — считаем нулём, человек допишет.
    // Округляем до целых долларов, как ручной ввод, чтобы колонки сходились.
    const spend = ceilDollars(row.spendCents ?? 0);
    const revenue = ceilDollars(row.revenueCents ?? 0);
    if (!spend && !revenue) return;

    const bps = DEFAULT_COMMISSION_BPS;
    await prisma.dayReport.create({
      data: {
        buyerId: row.buyerId,
        date: row.date,
        source: 'Facebook',
        revenueCents: revenue,
        spendNetCents: spend,
        commissionBps: bps,
        // Расход с комиссией: у Brocard она фактическая, иначе считаем по ставке.
        spendGrossCents:
          row.spendGrossCents !== undefined ? ceilDollars(row.spendGrossCents) : grossUp(spend, bps),
        spendSyncedCents: row.spendCents !== undefined ? spend : null,
        revenueSyncedCents: row.revenueCents !== undefined ? revenue : null,
        syncedAt: new Date(),
        note: 'заполнено автоматически',
      },
    });
    result.touched += 1;
    return;
  }

  const { data, skipped } = mergeDay(existing, {
    spendCents: row.spendCents,
    revenueCents: row.revenueCents,
    spendGrossCents: row.spendGrossCents,
  });

  if (Object.keys(data).length === 0) {
    if (skipped) result.skipped += 1;
    return;
  }

  await prisma.dayReport.update({
    where: { id: existing.id },
    data: { ...data, syncedAt: new Date() },
  });
  result.touched += 1;
  if (skipped) result.skipped += 1;
}

/**
 * Расход из Facebook — ИНФОРМАТИВНО, в отчёты дня не пишем.
 *
 * Реальный расход команды приходит из Brocard (фактические списания с карт).
 * Цифра из ФБ нужна для будущего мониторинга и управления кампаниями, поэтому
 * складывается в свою таблицу AdAccountDay, а не в DayReport — иначе подменила
 * бы настоящий расход, по которому считается зарплата.
 */
/**
 * Сессионный ключ из антидетекта живёт недолго и однажды перестаёт
 * приниматься (код 190 «протух» или код 1 «сессия кончилась»). Но куки того же
 * профиля обычно ещё живы, а из них ключ достаётся заново — тем же способом,
 * что и расширение FBtool: открываем куками Ads Manager через прокси аккаунта и
 * забираем свежий EAAB.
 *
 * Достали новый ключ — перекладываем его в мультитокен, сохранив куки и
 * user-agent, и пишем обратно. Синхронизация повторяет заход уже с ним и не
 * встаёт, не дёргая человека. Не вышло (куки тоже мертвы) — вернём null, и
 * тогда токен честно уходит в ошибку.
 */
export async function refreshTokenFromCookies(t: {
  id: string;
  token: string;
  cookiesJson: string | null;
  proxyUrl: string | null;
}): Promise<boolean> {
  if (!t.cookiesJson) return false;
  const fresh = await extractTokenFromCookies(t.cookiesJson, t.proxyUrl);
  if (!fresh || fresh.length < 20) return false;

  // Сохраняем куки и ua, меняем только сам ключ — так fbAccess дальше соберёт
  // тот же браузерный набор, только со свежим токеном.
  const { ua } = extractFbToken(t.token);
  let cookies: unknown = [];
  try {
    const parsed = JSON.parse(t.cookiesJson);
    cookies = Array.isArray(parsed) ? parsed : parsed?.cookies ?? [];
  } catch {
    cookies = [];
  }
  const blob = Buffer.from(JSON.stringify({ cookies, ua, token: fresh })).toString('base64');
  await prisma.adToken.update({ where: { id: t.id }, data: { token: blob } }).catch(ignoreMissing);
  t.token = blob;
  return true;
}

export async function syncFacebook(days = SYNC_DAYS): Promise<SyncResult> {
  const result = emptyResult();
  const { from, to } = daysBack(days);
  const now = new Date();

  // Дренаж старого архива: токены, отвязанные до перехода на заморозку, —
  // снимаем слепок агентского расхода и сносим ПОЛНОСТЬЮ (архив не держим).
  const archivedToks = await prisma.adToken.findMany({ where: { archived: true }, select: { id: true } });
  for (const at of archivedToks) {
    try { await freezeAgencySpend(at.id); await prisma.adToken.delete({ where: { id: at.id } }); }
    catch (e) { ignoreMissing(e); }
  }

  // Пропускаем токены на кулдауне: после троттлинга или «подозрительной
  // активности» аккаунт должен остыть, а не получать запросы по расписанию.
  const all = await prisma.adToken.findMany({
    where: { enabled: true, archived: false },
    include: { accounts: true, buyer: { select: { handle: true, userId: true } } },
  });
  const tokens = shuffle(all.filter((t) => !t.pausedUntil || t.pausedUntil <= now));

  // Дубли кабинетов (один act_ID под несколькими профилями): синкаем только
  // канонический, иначе расход задвоится.
  const canonical = await canonicalAccountIds(now);

  // Агентка в отчёт дня пишется НЕ здесь: её считаем в syncFacebookAds из
  // ad-level (как Кампании и КТ), иначе строка «Агентка» расходилась с
  // дашбордом на пару долларов (account-level ≠ ad-level).

  // Разные токены — разные аккаунты и прокси, поэтому ведём их ПАРАЛЛЕЛЬНО, до
  // FB_CONCURRENCY сразу: главный рычаг скорости. Серийность с паузами нужна
  // только ВНУТРИ одного аккаунта (ниже), чтобы не выглядеть роботом с его IP.
  await pool(tokens, FB_CONCURRENCY, async (token) => {
    // Один заход по токену. Выносим в функцию, чтобы при протухшем ключе
    // обновить его из кук и повторить ровно один раз.
    const work = async () => {
      // Доступ собираем как при добавлении: ключ, куки, ua и прокси аккаунта.
      const { token: access, net } = fbAccess(token.token, {
        cookiesJson: token.cookiesJson,
        proxyUrl: token.proxyUrl,
      });

      // Список кабинетов освежаем на каждом заходе и сразу пишем их статус из
      // Facebook — бан, риск-платёж, проверка видны без отдельного запроса.
      const seen = await listAccounts(access, net);
      for (const acc of seen) {
        // Прошлый статус — чтобы поймать МОМЕНТ ухода в бан и уведомить.
        const prev = await prisma.adAccount.findUnique({
          where: { tokenId_externalId: { tokenId: token.id, externalId: acc.externalId } },
          select: { accountStatus: true, disableReason: true, agency: true },
        });
        await prisma.adAccount.upsert({
          where: { tokenId_externalId: { tokenId: token.id, externalId: acc.externalId } },
          update: {
            name: acc.name,
            currency: acc.currency,
            accountStatus: acc.accountStatus,
            disableReason: acc.disableReason,
            spendCapCents: acc.spendCapCents,
            amountSpentCents: acc.amountSpentCents,
            balanceCents: acc.balanceCents,
          },
          create: {
            tokenId: token.id,
            externalId: acc.externalId,
            name: acc.name,
            currency: acc.currency,
            accountStatus: acc.accountStatus,
            disableReason: acc.disableReason,
            spendCapCents: acc.spendCapCents,
            amountSpentCents: acc.amountSpentCents,
            balanceCents: acc.balanceCents,
          },
        });
        // Был живой → стал мёртвый: уведомление баеру и админам.
        if (prev && !isDeadAccount(prev.accountStatus, prev.disableReason) && isDeadAccount(acc.accountStatus, acc.disableReason)) {
          await logActivity({
            kind: 'cabinet_banned',
            message: `🚫 Кабинет «${acc.name || acc.externalId}» ушёл в бан/отключён`,
            actorUserId: token.buyer?.userId,
            actorName: token.buyer?.handle ?? '',
          });
        }

        // Низкий остаток открута (< 200) на ЖИВОМ АГЕНТСКОМ кабинете — сигнал в
        // колокольчик, раз в сутки на кабинет (refKey с датой). Только агентские:
        // у ферм баланс живёт иначе (карты/предоплата мелкими суммами), и «$1/$3»
        // — это шум, а не низкий остаток. Совпадает с логикой пилюли «ост.».
        if (prev?.agency && !isDeadAccount(acc.accountStatus, acc.disableReason)) {
          const remCents = acc.spendCapCents > 0
            ? Math.max(0, acc.spendCapCents - acc.amountSpentCents)
            : acc.balanceCents > 0 ? acc.balanceCents : -1;
          if (remCents >= 0 && remCents / 100 < 200) {
            const money = acc.currency === 'USD' ? usd(remCents) : `${Math.round(remCents / 100).toLocaleString('ru-RU')} ${acc.currency}`;
            await logActivity({
              kind: 'low_balance',
              message: `⚠️ Низкий остаток на кабинете «${acc.name || acc.externalId}»: ${money}`,
              actorUserId: token.buyer?.userId,
              actorName: token.buyer?.handle ?? '',
              refKey: `low_balance:${acc.externalId}:${new Date().toISOString().slice(0, 10)}`,
            });
          }
        }
      }

      // Порядок кабинетов внутри токена — вперемешку: одинаковый обход из раза
      // в раз тоже читается как автомат.
      const accounts = shuffle(
        await prisma.adAccount.findMany({ where: { tokenId: token.id } }),
      );

      for (const acc of accounts) {
        // Дубль (тот же act_ID уже синкается под другим профилем) — пропускаем и
        // ЧИСТИМ его старые дневные строки за окно, чтобы задвоенный расход,
        // записанный раньше, ушёл сам (иначе сумма на странице остаётся вдвое).
        if (!canonical.has(acc.id)) {
          await prisma.adAccountDay.deleteMany({
            where: { accountId: acc.id, date: { gte: atMidnight(from), lte: atMidnight(to) } },
          });
          continue;
        }
        // Забаненные кабы НЕ пропускаем: если каб открутил деньги в окне и потом
        // забанился, этот расход реальный (он есть в ФБ) — и его надо тянуть,
        // иначе расход занижается. Окно всего 14 дней, так что «древнюю» историю
        // мёртвого каба мы и не подтянем — тянем только недавний реальный открут.
        // Пауза перед каждым запросом расхода: главный рычаг против чекпоинта.
        try {
        await humanPause();
        const spend = await accountSpend(access, acc.externalId, from, to, net);
        for (const d of spend) {
          await prisma.adAccountDay.upsert({
            where: { accountId_date: { accountId: acc.id, date: atMidnight(d.date) } },
            update: { spendCents: d.cents, currency: acc.currency },
            create: {
              accountId: acc.id,
              date: atMidnight(d.date),
              spendCents: d.cents,
              currency: acc.currency,
            },
          });
          result.touched += 1;
        }
        await prisma.adAccount.update({
          where: { id: acc.id },
          data: { lastSpendAt: new Date() },
        });

        // Детект резкого скачка расхода за ~2 часа. Реалтайм-часов у нас нет,
        // поэтому раз в 2 часа снимаем «метку» сегодняшнего расхода; на следующем
        // снятии смотрим прирост за окно и сравниваем со средним 2-часовым
        // расходом кабинета (по последним 7 дням). Резко больше — уведомляем.
        const nowT = new Date();
        const todayCents = spend.find((d) => d.date === nowT.toISOString().slice(0, 10))?.cents ?? 0;
        const TWO_H = 2 * 3600_000;
        if (!acc.spendMarkAt) {
          await prisma.adAccount.update({ where: { id: acc.id }, data: { spendMarkCents: todayCents, spendMarkAt: nowT } });
        } else if (nowT.getTime() - acc.spendMarkAt.getTime() >= TWO_H) {
          const sameDay = acc.spendMarkAt.toISOString().slice(0, 10) === nowT.toISOString().slice(0, 10);
          if (sameDay) {
            const delta = todayCents - acc.spendMarkCents;
            const weekAgo = new Date(nowT.getTime() - 7 * 24 * 3600_000);
            const rows = await prisma.adAccountDay.findMany({ where: { accountId: acc.id, date: { gte: weekAgo } }, select: { spendCents: true } });
            const avgDaily = rows.length ? rows.reduce((s, r) => s + r.spendCents, 0) / rows.length : 0;
            const baseline2h = avgDaily / 12; // 24ч / 2ч
            const FLOOR = 100 * 100; // не шумим на мелочи: минимум $100 за окно
            const threshold = Math.max(FLOOR, Math.round(2 * baseline2h));
            if (delta >= threshold) {
              const money = acc.currency === 'USD' ? usd(delta) : `${Math.round(delta / 100).toLocaleString('ru-RU')} ${acc.currency}`;
              await logActivity({
                kind: 'spend_spike',
                message: `📈 Резкий скачок расхода на «${acc.name || acc.externalId}»: ${money} за ~2 часа`,
                actorUserId: token.buyer?.userId,
                actorName: token.buyer?.handle ?? '',
                refKey: `spend_spike:${acc.externalId}:${nowT.toISOString().slice(0, 13)}`,
              });
            }
          }
          await prisma.adAccount.update({ where: { id: acc.id }, data: { spendMarkCents: todayCents, spendMarkAt: nowT } });
        }
        } catch (e) {
          if (isTokenLevelError(e)) throw e;
          result.info.push(`${token.buyer.handle}/${acc.name || acc.externalId}: ${e instanceof FbError ? e.message : (e as Error).message}`);
          result.skipped += 1;
        }
      }

      await prisma.adToken.update({
        where: { id: token.id },
        data: { lastSyncAt: new Date(), lastError: '', pausedUntil: null },
      }).catch(ignoreMissing);
    };

    try {
      await work();
    } catch (e) {
      // Ключ протух (190) или сессия кончилась (код 1) — пробуем достать
      // свежий из кук и повторить заход один раз. Вышло — как будто ничего не
      // было; не вышло — падаем в обычную обработку ниже с исходной ошибкой.
      const refreshable = fbErrorKind(e) === 'token' || (e instanceof FbError && e.code === 1);
      if (refreshable && token.cookiesJson) {
        try {
          if (await refreshTokenFromCookies(token)) {
            await work();
            return;
          }
        } catch {
          // обновление не удалось — сообщим об исходной проблеме
        }
      }
      const kind = fbErrorKind(e);
      const why = e instanceof FbError ? e.message : `Сбой: ${(e as Error).message}`;

      // Троттлинг или «подозрительная активность» — уводим ЭТОТ токен на
      // кулдаун. Остальные (у них свои прокси) идут дальше как ни в чём не
      // бывало: долбить именно этот аккаунт после сигнала и значит доводить
      // его до чекпоинта.
      const scary = kind === 'throttle' || kind === 'blocked';
      const pausedUntil = scary ? fbCooldownUntil(kind, now) : token.pausedUntil ?? null;
      const note = scary
        ? `${why} — токен на паузе до ${pausedUntil?.toLocaleString('ru-RU')}, чтобы не словить чекпоинт`
        : why;

      // Пользователю — коротко и без технических деталей FB: подробности всё
      // равно лежат в lastError токена (для админа в настройках).
      result.problems.push(
        scary
          ? `${token.buyer.handle}: профиль притормозили, чтоб не словить чекпоинт`
          : `${token.buyer.handle}: токен слетел — нужно обновить профиль`,
      );
      await prisma.adToken.update({
        where: { id: token.id },
        data: { lastError: note, lastSyncAt: new Date(), pausedUntil },
      }).catch(ignoreMissing);

      // Токен слетел (не троттлинг) — уведомляем баера/админов, но не чаще раза
      // в 12 часов на профиль (дедуп по нику), чтобы не заспамить.
      if (kind === 'token') {
        const since = new Date(now.getTime() - 12 * 3600_000);
        const dup = await prisma.activity.findFirst({
          where: { kind: 'token_expired', actorName: token.buyer.handle, createdAt: { gt: since } },
          select: { id: true },
        }).catch(() => null);
        if (!dup) {
          await logActivity({
            kind: 'token_expired',
            message: `🔑 Токен профиля «${token.buyer.handle}»${token.label ? ` (${token.label})` : ''} слетел — переподключи`,
            actorUserId: token.buyer.userId,
            actorName: token.buyer.handle,
          });
        }
      }
    }
  });

  return result;
}

/**
 * Доход из Keitaro. Отчёт приходит по кампаниям, кампания знает свою группу, а
 * группа привязана к баеру. Кампании без привязанной группы не теряются: их
 * доход складывается в `orphanCents` и виден в настройках.
 */
export async function syncKeitaro(days = SYNC_DAYS): Promise<SyncResult> {
  const result = emptyResult();
  const tracker = await prisma.tracker.findFirst({ where: { enabled: true } });
  if (!tracker) return result;

  const { from, to } = daysBack(days);
  try {
    const campaigns = await listCampaigns(tracker.baseUrl, tracker.apiKey);

    // Группы освежаем, привязку к баеру не трогаем — её ставил человек.
    const groups = new Map<string, string>();
    for (const c of campaigns) groups.set(c.groupId, c.groupName);
    for (const [externalId, name] of groups) {
      await prisma.trackerGroup.upsert({
        where: { externalId },
        update: { name, lastSeenAt: new Date() },
        create: { externalId, name, lastSeenAt: new Date() },
      });
    }

    const linked = await prisma.trackerGroup.findMany({ where: { buyerId: { not: null } } });
    const buyerOfGroup = new Map(linked.map((g) => [g.externalId, g.buyerId!]));
    const groupOfCampaign = new Map(campaigns.map((c) => [c.id, c.groupId]));
    const infoOfCampaign = new Map(campaigns.map((c) => [c.id, { name: c.name, groupId: c.groupId }]));

    const rows = await dailyRevenue(tracker.baseUrl, tracker.apiKey, from, to, SYNC_TZ);

    /** Доход по «баер + день»: у баера обычно несколько кампаний. */
    const byBuyerDay = new Map<string, number>();
    for (const row of rows) {
      // Доход по кампании и дню сохраняем как есть — на нём строится ROI по
      // потокам (свод с расходом из ФБ). Строку пишет только синк, спорить не с
      // кем, поэтому просто перезаписываем.
      const info = infoOfCampaign.get(row.campaignId);
      await prisma.ktCampaignDay.upsert({
        where: { campaignId_date: { campaignId: row.campaignId, date: atMidnight(row.date) } },
        update: {
          campaignName: info?.name ?? '',
          groupId: info?.groupId ?? '',
          revenueCents: row.revenueCents,
          conversions: row.conversions,
        },
        create: {
          campaignId: row.campaignId,
          date: atMidnight(row.date),
          campaignName: info?.name ?? '',
          groupId: info?.groupId ?? '',
          revenueCents: row.revenueCents,
          conversions: row.conversions,
        },
      });

      const groupId = groupOfCampaign.get(row.campaignId);
      const buyerId = groupId ? buyerOfGroup.get(groupId) : undefined;
      if (!buyerId) {
        result.orphanCents += row.revenueCents;
        continue;
      }
      const key = `${buyerId}|${row.date}`;
      byBuyerDay.set(key, (byBuyerDay.get(key) ?? 0) + row.revenueCents);
    }

    for (const [key, cents] of byBuyerDay) {
      const [buyerId, iso] = key.split('|');
      await writeDay({ buyerId, date: atMidnight(iso), revenueCents: cents }, result);
    }

    if (result.orphanCents > 0) {
      const unlinked = [...groups.keys()].filter((id) => !buyerOfGroup.has(id)).length;
      result.problems.push(
        `Keitaro: ${unlinked} групп без баера — их доход никуда не записан`,
      );
    }

    await prisma.tracker.update({
      where: { id: tracker.id },
      data: { lastSyncAt: new Date(), lastError: '' },
    });
  } catch (e) {
    const why = e instanceof KeitaroError ? e.message : `Сбой: ${(e as Error).message}`;
    result.problems.push(`Keitaro: ${why}`);
    await prisma.tracker.update({
      where: { id: tracker.id },
      data: { lastError: why, lastSyncAt: new Date() },
    });
  }

  return result;
}

/**
 * Реальный расход из Brocard. Платёж по карте относится к команде
 * (`user.team`), команда привязана к баеру — по ней и делим расход. Чистыми
 * берём `amount`, а `amount + комиссия Brocard` кладём в «расход с комиссией».
 *
 * Расход без привязанной команды не теряется: копится в orphan и виден в
 * настройках отдельной строкой.
 */
export async function syncBrocard(days = SYNC_DAYS): Promise<SyncResult> {
  const result = emptyResult();
  const config = await prisma.brocardConfig.findFirst({ where: { enabled: true } });
  if (!config) return result;

  const { from, to } = daysBack(days);
  try {
    const teams = await listTeams(config.apiKey);
    for (const t of teams) {
      await prisma.brocardTeam.upsert({
        where: { externalId: t.id },
        update: { name: t.name, lastSeenAt: new Date() },
        create: { externalId: t.id, name: t.name, lastSeenAt: new Date() },
      });
    }

    const linked = await prisma.brocardTeam.findMany({ where: { buyerId: { not: null } } });
    const buyerOfTeam = new Map(linked.map((t) => [t.externalId, t.buyerId!]));

    // Команды-«общак»: их расход — расходники на команду, а не спенд баера.
    // Помечаются вручную в источниках (выбор «Расходники на команду»).
    const overheadTeams = await prisma.brocardTeam.findMany({ where: { overhead: true } });
    const overheadIds = new Set(overheadTeams.map((t) => t.externalId));

    const { rows, voidedCents, voidedCount } = await dailySpend(config.apiKey, from, to, SYNC_TZ);
    if (voidedCount > 0) {
      result.info.push(
        `Brocard: исключено ${voidedCount} void/возврат на $${(voidedCents / 100).toFixed(2)} (в расход не пошли).`,
      );
    }

    /**
     * Расход по «баер + день» = вся сумма с Brocard (тело платежа + внутренние
     * сборы Brocard). Это «Сумма» в кабинете Brocard — фактически потраченное,
     * дробить её не надо. Сверху синк сам накинет комиссию за пополнение 4.5%
     * обратным процентом (как «с комиссией» у ручного ввода) — отдельный gross
     * тут не передаём.
     */
    const total = new Map<string, number>();
    const overheadByDay = new Map<string, number>();
    let orphan = 0;
    for (const row of rows) {
      const amount = row.amountCents + row.feeCents;
      // «Общак» — расходники на команду: копим по дню, ни к кому не привязываем.
      if (overheadIds.has(row.teamId)) {
        overheadByDay.set(row.date, (overheadByDay.get(row.date) ?? 0) + amount);
        continue;
      }
      const buyerId = buyerOfTeam.get(row.teamId);
      if (!buyerId) {
        orphan += amount;
        continue;
      }
      const key = `${buyerId}|${row.date}`;
      total.set(key, (total.get(key) ?? 0) + amount);
    }

    for (const [key, cents] of total) {
      const [buyerId, iso] = key.split('|');
      await writeDay(
        {
          buyerId,
          date: atMidnight(iso),
          spendCents: cents,
        },
        result,
      );
    }

    // Расходники на команду переписываем как есть: строку пишет только синк,
    // руками её не трогают, спорить не с кем.
    for (const [iso, cents] of overheadByDay) {
      const date = atMidnight(iso);
      await prisma.overheadDay.upsert({
        where: { date },
        update: { spendCents: cents },
        create: { date, spendCents: cents },
      });
    }

    if (orphan > 0) {
      // Команды без баера, но не «общак» — их расход действительно потерян.
      const unlinked = teams.filter(
        (t) => !buyerOfTeam.has(t.id) && !overheadIds.has(t.id),
      ).length;
      result.problems.push(
        `Brocard: ${unlinked} команд без баера — их расход $${Math.round(orphan / 100).toLocaleString('ru-RU')} не записан`,
      );
    }

    await prisma.brocardConfig.update({
      where: { id: config.id },
      data: { lastSyncAt: new Date(), lastError: '' },
    });
  } catch (e) {
    const why = e instanceof BrocardError ? e.message : `Сбой: ${(e as Error).message}`;
    result.problems.push(`Brocard: ${why}`);
    await prisma.brocardConfig.update({
      where: { id: config.id },
      data: { lastError: why, lastSyncAt: new Date() },
    });
  }

  return result;
}

/** Все источники разом — то, что дёргает кнопка в настройках и крон. */
/**
 * Отдельный лёгкий заход ТОЛЬКО за кампаниями — статус и бюджет, без расхода.
 *
 * Мониторингу нужна свежесть: днём гоняем часто, ночью реже (расписание крона).
 * Поэтому кампании отвязаны от тяжёлого 14-дневного расхода и ходят своим
 * циклом — те же защиты: параллельно по токенам, пауза внутри токена, кулдаун,
 * обновление протухшего ключа из кук.
 */
export async function syncFacebookCampaigns(): Promise<SyncResult> {
  const result = emptyResult();
  const now = new Date();
  const all = await prisma.adToken.findMany({
    where: { enabled: true, archived: false },
    include: { accounts: true, buyer: { select: { handle: true, userId: true } } },
  });
  const tokens = shuffle(all.filter((t) => !t.pausedUntil || t.pausedUntil <= now));

  await pool(tokens, FB_CONCURRENCY, async (token) => {
    const work = async () => {
      const { token: access, net } = fbAccess(token.token, {
        cookiesJson: token.cookiesJson,
        proxyUrl: token.proxyUrl,
      });
      for (const acc of shuffle(token.accounts)) {
        // Мёртвый кабинет (бан/закрыт) — кампании оттуда не тянем: они все
        // стоят, толку ноль, а запрос лишний.
        if (isDeadAccount(acc.accountStatus, acc.disableReason)) continue;
        try {
        await humanPause();
        const camps = await listFbCampaigns(access, acc.externalId, net);
        const liveIds: string[] = [];
        for (const c of camps) {
          liveIds.push(c.campaignId);
          await prisma.fbCampaign.upsert({
            where: { campaignId: c.campaignId },
            update: { name: c.name, status: c.status, dailyBudget: c.dailyBudget, adAccountId: acc.id },
            create: {
              adAccountId: acc.id,
              campaignId: c.campaignId,
              name: c.name,
              status: c.status,
              dailyBudget: c.dailyBudget,
            },
          });
          result.touched += 1;
        }
        // Пропавшие под кабинетом кампании убираем (удалены/архив вне выборки).
        await prisma.fbCampaign.deleteMany({
          where: { adAccountId: acc.id, campaignId: { notIn: liveIds.length ? liveIds : ['__none__'] } },
        });
        } catch (e) {
          if (isTokenLevelError(e)) throw e;
          result.info.push(`${token.buyer.handle}/${acc.name || acc.externalId}: ${e instanceof FbError ? e.message : (e as Error).message}`);
          result.skipped += 1;
        }
      }
      await prisma.adToken.update({
        where: { id: token.id },
        data: { lastSyncAt: new Date(), lastError: '', pausedUntil: null },
      }).catch(ignoreMissing);
    };

    try {
      await work();
    } catch (e) {
      const refreshable = fbErrorKind(e) === 'token' || (e instanceof FbError && e.code === 1);
      if (refreshable && token.cookiesJson) {
        try {
          if (await refreshTokenFromCookies(token)) {
            await work();
            return;
          }
        } catch {
          /* обновление не удалось — сообщим об исходной ошибке */
        }
      }
      const kind = fbErrorKind(e);
      const why = e instanceof FbError ? e.message : `Сбой: ${(e as Error).message}`;
      const scary = kind === 'throttle' || kind === 'blocked';
      const pausedUntil = scary ? fbCooldownUntil(kind, now) : token.pausedUntil ?? null;
      const note = scary ? `${why} — токен на паузе до ${pausedUntil?.toLocaleString('ru-RU')}` : why;
      // Пользователю — коротко и без технических деталей FB: подробности всё
      // равно лежат в lastError токена (для админа в настройках).
      result.problems.push(
        scary
          ? `${token.buyer.handle}: профиль притормозили, чтоб не словить чекпоинт`
          : `${token.buyer.handle}: токен слетел — нужно обновить профиль`,
      );
      await prisma.adToken.update({
        where: { id: token.id },
        data: { lastError: note, lastSyncAt: new Date(), pausedUntil },
      }).catch(ignoreMissing);

      // Токен слетел (не троттлинг) — уведомляем баера/админов, но не чаще раза
      // в 12 часов на профиль (дедуп по нику), чтобы не заспамить.
      if (kind === 'token') {
        const since = new Date(now.getTime() - 12 * 3600_000);
        const dup = await prisma.activity.findFirst({
          where: { kind: 'token_expired', actorName: token.buyer.handle, createdAt: { gt: since } },
          select: { id: true },
        }).catch(() => null);
        if (!dup) {
          await logActivity({
            kind: 'token_expired',
            message: `🔑 Токен профиля «${token.buyer.handle}»${token.label ? ` (${token.label})` : ''} слетел — переподключи`,
            actorUserId: token.buyer.userId,
            actorName: token.buyer.handle,
          });
        }
      }
    }
  });

  return result;
}

/** Кампания КТ, найденная по токену из ссылки объявления. */
type MatchedCampaign = { id: string; name: string; token: string };

/** Первый кандидат из ссылки, который есть в индексе токенов кампаний КТ. */
function matchKtCampaign(link: string, index: Map<string, MatchedCampaign>): MatchedCampaign | null {
  for (const cand of parseKtCandidates(link)) {
    const hit = index.get(cand);
    if (hit) return hit;
  }
  return null;
}

/**
 * Расход из Facebook НА УРОВНЕ ОБЪЯВЛЕНИЙ, привязанный к потокам Keitaro.
 *
 * Зачем отдельно от расхода кабинета: в ссылке каждого объявления стоит токен
 * кампании КТ (`track.top/qynyTnDK`). Раскладываем расход по объявлениям, из
 * ссылки достаём токен, находим кампанию в трекере — и суммируем расход по
 * кампании КТ и дню. Отсюда виден ROI по каждому потоку, а не только доход.
 *
 * Защиты те же, что у прочих заходов в ФБ: параллельно по токенам, пауза внутри
 * токена, кулдаун при троттлинге, обновление протухшего ключа из кук. Тянем
 * ссылки только у объявлений, где реально был расход, — запросов немного.
 */
export async function syncFacebookAds(days = 7, opts: { allAds?: boolean } = {}): Promise<SyncResult> {
  const result = emptyResult();
  const { from, to } = daysBack(days);
  const now = new Date();
  // allAds: тянуть и объявления без открута (перечислением ads кабинета), чтобы
  // они были в таблице под фильтром «без открута». Дороже (лишние запросы к ФБ),
  // поэтому включаем только на ручном обновлении, не на частом кроне.
  const allAds = Boolean(opts.allAds);

  // Индекс токенов кампаний КТ: по ключу из ссылки объявления → кампания.
  // Без трекера привязывать не к чему — расход соберём, но потоки не проставим.
  const index = new Map<string, MatchedCampaign>();
  // Доход по объявлению из КТ (sub_id_4 = ad_id) — для профита в таблице.
  const revByAd = new Map<string, number>();
  // Кампания КТ по id → имя и токен (для витрины расхода) и карта
  // «ad_id → кампания» по самим кликам КТ (главный способ привязать расход).
  const campById = new Map<string, { name: string; token: string }>();
  // Привязка объявление→кампания по кликам КТ за всё окно (главный способ узнать
  // кампанию объявления). Ключ — ad_id.
  const adByClickAd = new Map<string, string>();
  const tracker = await prisma.tracker.findFirst({ where: { enabled: true } });
  if (tracker) {
    try {
      const camps = await listCampaigns(tracker.baseUrl, tracker.apiKey);
      for (const [key, c] of indexByToken(camps)) {
        index.set(key, { id: c.id, name: c.name, token: c.token || c.alias });
      }
      for (const c of camps) campById.set(c.id, { name: c.name, token: c.token || c.alias });

      // Привязка объявление→кампания по кликам КТ — покрывает и то, чего нет в
      // ссылке. Не критично, если не вышло: ниже есть запасной матчинг по ссылке.
      try {
        const m = await adCampaignMap(tracker.baseUrl, tracker.apiKey, from, to, SYNC_TZ);
        for (const [sub, campId] of m.adMap) adByClickAd.set(sub, campId);
      } catch { /* оставим матчинг по ссылке */ }

      const adRev = await revenueByAd(tracker.baseUrl, tracker.apiKey, from, to, SYNC_TZ);
      for (const r of adRev) revByAd.set(`${r.subId4}|${r.date}`, r.revenueCents);

      // Заодно освежаем доход по кампаниям за это же окно — чтобы экран
      // статистики был самодостаточным (расход и доход одной кнопкой), а не
      // ждал отдельного полного синка Keitaro.
      const info = new Map(camps.map((c) => [c.id, { name: c.name, groupId: c.groupId }]));
      const rev = await dailyRevenue(tracker.baseUrl, tracker.apiKey, from, to, SYNC_TZ);
      for (const r of rev) {
        const meta = info.get(r.campaignId);
        await prisma.ktCampaignDay.upsert({
          where: { campaignId_date: { campaignId: r.campaignId, date: atMidnight(r.date) } },
          update: {
            campaignName: meta?.name ?? '',
            groupId: meta?.groupId ?? '',
            revenueCents: r.revenueCents,
            conversions: r.conversions,
          },
          create: {
            campaignId: r.campaignId,
            date: atMidnight(r.date),
            campaignName: meta?.name ?? '',
            groupId: meta?.groupId ?? '',
            revenueCents: r.revenueCents,
            conversions: r.conversions,
          },
        });
      }
    } catch (e) {
      const why = e instanceof KeitaroError ? e.message : `Сбой: ${(e as Error).message}`;
      result.problems.push(`Keitaro: не получить данные для привязки расхода — ${why}`);
    }
  } else {
    result.problems.push('Keitaro не подключён — расход не к чему привязать');
  }

  // Копим расход по «кампания КТ + день» за весь заход: на один поток могут
  // лить сразу несколько кабинетов, поэтому суммируем глобально, а пишем в
  // KtCostDay уже после обхода.
  type Bucket = { cents: number; clicks: number; impressions: number; currency: string; campId: string; campName: string; token: string };
  const cost = new Map<string, Bucket>();
  let unmatchedCents = 0;
  // Куда «утекает» расход — по профилю (соцу). Так в отчёте видно, у какой
  // группы открут не привязался к кампании КТ: обычно это новые группы, где в
  // кликах не проставлен ad_id (Sub ID 4) или токен в ссылке не распознан.
  const unmatchedByHandle = new Map<string, number>();
  const matchedByHandle = new Map<string, number>();
  // Диагностика заливки: сколько объявлений с расходом сматчилось с потоком, и
  // сколько дней-строк пропущено из-за не-USD кабинета (в КТ льём только доллары).
  let matchedAds = 0;
  let nonUsdDays = 0;
  let nonUsdCents = 0;
  let totalSpendCents = 0;
  let zeroAds = 0; // объявления без открута, заведённые перечислением кабинета
  let prunedAds = 0; // удалённые из базы объявления, которых больше нет в ФБ

  // Расход копим по (кампания КТ, день) в `cost` выше — весь дневной расход
  // объявления идёт в его кампанию целиком (как в дешборде).

  const all = await prisma.adToken.findMany({
    where: { enabled: true, archived: false },
    include: { accounts: true, buyer: { select: { handle: true, userId: true } } },
  });
  const tokens = shuffle(all.filter((t) => !t.pausedUntil || t.pausedUntil <= now));

  // Профили, пропущенные на паузе (троттлинг/бан), в этом заходе не отчитываются
  // — их расход не «исчез», а просто не собран сейчас. Вместе с runGaps (сбои по
  // ходу захода) это признак НЕполного захода: при нём витрину расхода не чистим
  // «по хвостам», чтобы не стереть реальные суммы недособранных кабинетов.
  const pausedSkipped = all.length - tokens.length;
  let runGaps = 0;

  // Дубли кабинетов (один act_ID под несколькими профилями): расход тянем только
  // с канонического, иначе он задвоится в заливке КТ.
  const canonical = await canonicalAccountIds(now);

  // Снимок проблем ДО обхода: каждый слетевший по ходу профиль дописывает ровно
  // одну запись в result.problems, так что разница после обхода = число упавших
  // токенов. Нужно, чтобы отличить полный заход от неполного (см. витрину ниже).
  const problemsBefore = result.problems.length;

  await pool(tokens, FB_CONCURRENCY, async (token) => {
    const work = async () => {
      const { token: access, net } = fbAccess(token.token, {
        cookiesJson: token.cookiesJson,
        proxyUrl: token.proxyUrl,
      });

      for (const acc of shuffle(token.accounts)) {
        // Дубль (тот же act_ID уже тянется под другим профилем) — пропускаем,
        // чтобы расход не задвоился.
        if (!canonical.has(acc.id)) continue;
        // Забаненные кабы тянем тоже: их недавний открут в окне реальный (есть в
        // ФБ) и обязан долететь в КТ, иначе расход недобирает. Окно 14 дней —
        // старьё мёртвого каба всё равно не подтянется, только свежий открут.
        try {
        await humanPause();
        const stats = await adStats(access, acc.externalId, from, to, net);
        const statIds = new Set(stats.map((s) => s.adId));

        // Набор объявлений для меты: те, что с открутом, плюс (для ручного
        // обновления) все живые объявления кабинета — так в таблицу попадут и
        // те, что без открута (свежие дубли на паузе и т.п.).
        let adIds = [...statIds];
        let listed: string[] = [];
        if (allAds) {
          try {
            listed = await listAdIds(access, acc.externalId, net);
            adIds = [...new Set([...statIds, ...listed])];
          } catch {
            /* перечисление не удалось — продолжаем только с теми, что с открутом */
          }
        }
        if (adIds.length === 0) continue;

        const nameOf = new Map(stats.map((s) => [s.adId, s.adName]));
        const metas = await adMeta(access, adIds, net);
        const metaOf = new Map(metas.map((m) => [m.adId, m]));

        // Дневные строки по объявлению: обходим по объявлению, чтобы сначала
        // завести/обновить сам FbAd (мету), а потом его дни (FbAdDay).
        const byAd = new Map<string, typeof stats>();
        for (const s of stats) {
          const arr = byAd.get(s.adId) ?? [];
          arr.push(s);
          byAd.set(s.adId, arr);
        }

        // Пре-проход: у каждого объявления определяем кампанию КТ (по кликам,
        // иначе по токену в ссылке) и голосуем по адсету. У объявлений, где
        // кампанию так и не нашли, ниже возьмём доминирующую по их адсету — в
        // одном адсете обычно один лендинг = один поток, так что расход дольётся
        // в правильную кампанию, а не потеряется.
        const adCampOf = new Map<string, string>();
        const adsetVotes = new Map<string, Map<string, number>>();
        for (const [adId] of byAd) {
          const m = metaOf.get(adId);
          const cid = adByClickAd.get(adId) || matchKtCampaign(m?.link ?? '', index)?.id || '';
          adCampOf.set(adId, cid);
          const adset = m?.adsetId ?? '';
          if (cid && adset) {
            const v = adsetVotes.get(adset) ?? new Map<string, number>();
            v.set(cid, (v.get(cid) ?? 0) + 1);
            adsetVotes.set(adset, v);
          }
        }
        const adsetDominant = new Map<string, string>();
        for (const [adset, v] of adsetVotes) {
          let best = '', bestN = 0;
          for (const [cid, n] of v) if (n > bestN) { best = cid; bestN = n; }
          adsetDominant.set(adset, best);
        }

        for (const [adId, rows] of byAd) {
          const m = metaOf.get(adId);
          const link = m?.link ?? '';
          // Кампания КТ для расхода: сперва по САМИМ кликам (ad_id → кампания,
          // где реально лежат клики — надёжно), иначе по токену в ссылке, иначе
          // — доминирующая кампания адсета (сосед по группе). Так cost ложится
          // туда же, где клики, и не теряется у объявлений без своего сигнала.
          const linkMatch = matchKtCampaign(link, index);
          // Уровень объявления — для токена/отображения и как запас, если по дню
          // клика не нашлось.
          const ktCampId = adCampOf.get(adId) || adsetDominant.get(m?.adsetId ?? '') || '';
          const ktCamp = ktCampId ? campById.get(ktCampId) : undefined;
          const ktCampName = ktCamp?.name ?? linkMatch?.name ?? '';
          const ktTokenVal = linkMatch?.token || ktCamp?.token || '';
          if (ktCampId) matchedAds += 1;

          const fbAd = await prisma.fbAd.upsert({
            where: { adId },
            update: {
              adAccountId: acc.id,
              name: m?.name || nameOf.get(adId) || '',
              status: m?.status ?? 'UNKNOWN',
              adsetId: m?.adsetId ?? '',
              adsetName: m?.adsetName ?? '',
              campaignId: m?.campaignId ?? '',
              campaignName: m?.campaignName ?? '',
              dailyBudget: m?.dailyBudget ?? null,
              budgetTargetId: m?.budgetTargetId ?? '',
              targeting: m?.targeting ?? '',
              thumbnailUrl: m?.thumbnailUrl ?? '',
              linkUrl: link,
              ktToken: ktTokenVal,
              lastSpendAt: new Date(),
            },
            create: {
              adAccountId: acc.id,
              adId,
              name: m?.name || nameOf.get(adId) || '',
              status: m?.status ?? 'UNKNOWN',
              adsetId: m?.adsetId ?? '',
              adsetName: m?.adsetName ?? '',
              dailyBudget: m?.dailyBudget ?? null,
              budgetTargetId: m?.budgetTargetId ?? '',
              targeting: m?.targeting ?? '',
              thumbnailUrl: m?.thumbnailUrl ?? '',
              linkUrl: link,
              ktToken: ktTokenVal,
              lastSpendAt: new Date(),
            },
          });

          for (const s of rows) {
            totalSpendCents += s.cents;
            // Дневные метрики объявления + доход из КТ по ad_id (для профита).
            const revenueCents = revByAd.get(`${adId}|${s.date}`) ?? 0;
            await prisma.fbAdDay.upsert({
              where: { adId_date: { adId: fbAd.id, date: atMidnight(s.date) } },
              update: {
                spendCents: s.cents,
                impressions: s.impressions,
                clicks: s.clicks,
                leads: s.leads,
                revenueCents,
                currency: acc.currency,
              },
              create: {
                adId: fbAd.id,
                date: atMidnight(s.date),
                spendCents: s.cents,
                impressions: s.impressions,
                clicks: s.clicks,
                leads: s.leads,
                revenueCents,
                currency: acc.currency,
              },
            });
            result.touched += 1;

            // Агентскую строку «Агентка» НЕ копим здесь: её сумму собираем ниже
            // из накопленного FbAdDay, а не из текущего захода (см. комментарий
            // у блока reconcile). Иначе частичный заход занижал бы день.

            // В КТ льём только доллары (агентские кабинеты всегда USD).
            if (acc.currency !== 'USD') {
              nonUsdDays += 1;
              nonUsdCents += s.cents;
              continue;
            }

            // Весь дневной расход объявления идём В ЕГО КАМПАНИЮ КТ целиком (та
            // же кампания, что показывает дешборд — ktCampId). Суммируем по
            // (кампания, день); заливаем потом на campaign_id БЕЗ фильтра по
            // кликам — чтобы у кампании стоял весь её расход, как в дешборде, а
            // не только доля, что КТ смог посадить на клики фильтром sub_id_4.
            // Так совпадает и по дням, и по группам, даже когда групп много.
            if (ktCampId) {
              const dayCamp = campById.get(ktCampId);
              const key = `${ktCampId}|${s.date}`;
              const b = cost.get(key) ?? {
                cents: 0, clicks: 0, impressions: 0, currency: acc.currency,
                campId: ktCampId, campName: dayCamp?.name ?? ktCampName, token: dayCamp?.token ?? ktTokenVal,
              };
              b.cents += s.cents; b.clicks += s.clicks; b.impressions += s.impressions;
              cost.set(key, b);
              matchedByHandle.set(token.buyer.handle, (matchedByHandle.get(token.buyer.handle) ?? 0) + s.cents);
            } else {
              unmatchedCents += s.cents;
              unmatchedByHandle.set(token.buyer.handle, (unmatchedByHandle.get(token.buyer.handle) ?? 0) + s.cents);
            }
          }
        }

        // Объявления без открута (есть в кабинете, но не в статистике окна) —
        // заводим/обновляем саму карточку без дневных строк, чтобы их было видно
        // в таблице под фильтром «без открута». Расход/дни у них не трогаем.
        if (allAds) {
          for (const adId of adIds) {
            if (statIds.has(adId)) continue;
            const m = metaOf.get(adId);
            if (!m) continue;
            const link = m.link ?? '';
            const matched = matchKtCampaign(link, index);
            const data = {
              adAccountId: acc.id,
              name: m.name || '',
              status: m.status ?? 'UNKNOWN',
              adsetId: m.adsetId ?? '',
              adsetName: m.adsetName ?? '',
              campaignId: m.campaignId ?? '',
              campaignName: m.campaignName ?? '',
              dailyBudget: m.dailyBudget ?? null,
              budgetTargetId: m.budgetTargetId ?? '',
              targeting: m.targeting ?? '',
              thumbnailUrl: m.thumbnailUrl ?? '',
              linkUrl: link,
              ktToken: matched?.token ?? '',
            };
            await prisma.fbAd.upsert({
              where: { adId },
              update: data,
              create: { adId, ...data },
            });
            zeroAds += 1;
          }
        }

        // Чистим пропавшие: если получили реальный список живых объявлений
        // кабинета (listed непустой), удаляем из базы те, которых в ФБ уже нет
        // (удалённые/архивные дубли и т.п.). Пустой listed = перечисление не
        // удалось — тогда ничего не трогаем, чтобы не снести живые по ошибке.
        if (allAds && listed.length > 0) {
          const live = [...new Set([...statIds, ...listed])];
          const del = await prisma.fbAd.deleteMany({
            where: { adAccountId: acc.id, adId: { notIn: live } },
          });
          prunedAds += del.count;
        }
        } catch (e) {
          if (isTokenLevelError(e)) throw e;
          result.info.push(`${token.buyer.handle}/${acc.name || acc.externalId}: ${e instanceof FbError ? e.message : (e as Error).message}`);
          result.skipped += 1;
          runGaps += 1; // кабинет не дособрал — заход неполный
        }
      }

      await prisma.adToken.update({
        where: { id: token.id },
        data: { lastSyncAt: new Date(), lastError: '', pausedUntil: null },
      }).catch(ignoreMissing);
    };

    try {
      await work();
    } catch (e) {
      const refreshable = fbErrorKind(e) === 'token' || (e instanceof FbError && e.code === 1);
      if (refreshable && token.cookiesJson) {
        try {
          if (await refreshTokenFromCookies(token)) {
            await work();
            return;
          }
        } catch {
          /* обновление не удалось — сообщим об исходной ошибке */
        }
      }
      const kind = fbErrorKind(e);
      const why = e instanceof FbError ? e.message : `Сбой: ${(e as Error).message}`;
      const scary = kind === 'throttle' || kind === 'blocked';
      const pausedUntil = scary ? fbCooldownUntil(kind, now) : token.pausedUntil ?? null;
      const note = scary ? `${why} — токен на паузе до ${pausedUntil?.toLocaleString('ru-RU')}` : why;
      // Пользователю — коротко и без технических деталей FB: подробности всё
      // равно лежат в lastError токена (для админа в настройках).
      result.problems.push(
        scary
          ? `${token.buyer.handle}: профиль притормозили, чтоб не словить чекпоинт`
          : `${token.buyer.handle}: токен слетел — нужно обновить профиль`,
      );
      await prisma.adToken.update({
        where: { id: token.id },
        data: { lastError: note, lastSyncAt: new Date(), pausedUntil },
      }).catch(ignoreMissing);
    }
  });

  // Строка «Агентка» в отчёт дня — пересчитываем из НАКОПЛЕННОГО FbAdDay
  // (sticky-хранилище по объявлениям), а НЕ из суммы текущего захода.
  //
  // Раньше сумму копили по кабам, которые синкнулись ИМЕННО этот раз, и ею
  // перезаписывали день. Любой частичный заход (каб притормозило троттлингом,
  // слетел профиль, per-cabinet skip) выкидывал часть открута из суммы и ронял
  // строку «Агентка» вниз — при этом FbAdDay (а значит Кампании и КТ) сохранял
  // полную картину (там upsert по объявлению, а не пересчёт). Отсюда и перекос:
  // в КТ всё ок, а в «Днях»/на дашборде агентка занижена именно за свежие дни.
  //
  // Теперь источник один — FbAdDay: окно шире захода (чтобы залечить уже
  // испорченные дни), агентские кабы в USD, группировка по баеру токена. Ручные
  // правки строки по-прежнему уважаем — это внутри writeAgencyDay.
  const recWindow = daysBack(Math.max(days, SYNC_DAYS));
  const agencyRows = await prisma.fbAdDay.findMany({
    where: {
      date: { gte: atMidnight(recWindow.from), lte: atMidnight(recWindow.to) },
      ad: { adAccount: { agency: true, currency: 'USD' } },
    },
    select: {
      date: true,
      spendCents: true,
      // Процент берём с АГЕНТА кабинета (у разных агентов свой). Нет агента —
      // дефолт 6%. Так расход каждого кабинета грейсапится своей ставкой.
      ad: { select: { adAccount: { select: {
        agent: { select: { commissionBps: true } },
        adToken: { select: { buyerId: true } },
      } } } },
    },
  });
  // На баера за день суммируем net и gross: gross считаем ПО КАЖДОМУ кабинету его
  // ставкой (разные агенты — разные %), поэтому строка дня несёт суммарный gross,
  // а не «один процент на всё».
  const agencyByBuyerDay = new Map<string, { net: number; gross: number }>();
  for (const r of agencyRows) {
    const buyerId = r.ad.adAccount.adToken.buyerId;
    if (!buyerId) continue;
    const bps = r.ad.adAccount.agent?.commissionBps ?? AGENCY_COMMISSION_BPS;
    const k = `${buyerId}|${dayKey(r.date)}`;
    const cur = agencyByBuyerDay.get(k) ?? { net: 0, gross: 0 };
    cur.net += r.spendCents;
    cur.gross += grossUp(r.spendCents, bps);
    agencyByBuyerDay.set(k, cur);
  }
  // Замороженный расход удалённых агентских кабинетов — добавляем к живому. Если
  // externalId слепка снова живой (кабинет добавили заново), слепок игнорируем:
  // его покрывает живой FbAdDay. Такие слепки заодно подчищаем.
  const frozen = await prisma.agencyFrozenDay.findMany({
    where: { date: { gte: atMidnight(recWindow.from), lte: atMidnight(recWindow.to) } },
    select: { buyerId: true, externalId: true, date: true, netCents: true, grossCents: true },
  });
  if (frozen.length) {
    const liveExt = new Set(
      (await prisma.adAccount.findMany({ where: { agency: true }, select: { externalId: true } })).map((a) => a.externalId),
    );
    const staleExt = new Set<string>();
    for (const f of frozen) {
      if (liveExt.has(f.externalId)) { staleExt.add(f.externalId); continue; }
      const k = `${f.buyerId}|${dayKey(f.date)}`;
      const cur = agencyByBuyerDay.get(k) ?? { net: 0, gross: 0 };
      cur.net += f.netCents;
      cur.gross += f.grossCents;
      agencyByBuyerDay.set(k, cur);
    }
    if (staleExt.size) {
      await prisma.agencyFrozenDay.deleteMany({ where: { externalId: { in: [...staleExt] } } }).catch(ignoreMissing);
    }
  }
  for (const [key, sums] of agencyByBuyerDay) {
    const [buyerId, iso] = key.split('|');
    await writeAgencyDay(buyerId, iso, sums.net, sums.gross, result);
  }

  // Витрину расхода обновляем УСТОЙЧИВО к неполному заходу. Было: стирали всё
  // окно и заливали заново из `cost` — а `cost` содержит только то, что собрали
  // ИМЕННО сейчас. Если заход оборвался в моменте (профиль слетел, троттлинг,
  // пропуск кабинета), расход недособранных кабов исчезал из витрины до
  // следующего полного захода — ровно та «обрушилась подтяжка и сбросила
  // расход».
  //
  // Теперь: present-ключи всегда upsert-им (их данные свежие и не теряются), а
  // «хвосты» (кампании без открута в этом окне) чистим ТОЛЬКО если заход прошёл
  // ПОЛНОСТЬЮ — без упавших токенов, без пропущенных кабинетов и без профилей на
  // паузе. При неполном заходе чужой расход остаётся как есть и дотянется в
  // следующем заходе по своей очереди. Всё в своём try, чтобы сбой витрины не
  // сорвал заливку в сам КТ ниже.
  try {
    const fromDate = atMidnight(from);
    const toDate = atMidnight(to);
    const present = new Set<string>();
    for (const [key, b] of cost) {
      const iso = key.split('|')[1];
      const dateAt = atMidnight(iso);
      present.add(`${b.token}|${iso}`);
      await prisma.ktCostDay.upsert({
        where: { ktToken_date: { ktToken: b.token, date: dateAt } },
        update: {
          ktCampaignId: b.campId,
          ktCampaignName: b.campName,
          spendCents: b.cents,
          clicks: b.clicks,
          impressions: b.impressions,
          currency: b.currency,
        },
        create: {
          date: dateAt,
          ktToken: b.token,
          ktCampaignId: b.campId,
          ktCampaignName: b.campName,
          spendCents: b.cents,
          clicks: b.clicks,
          impressions: b.impressions,
          currency: b.currency,
        },
      });
    }
    const tokenFailures = result.problems.length - problemsBefore;
    const fullPass = tokenFailures === 0 && runGaps === 0 && pausedSkipped === 0;
    if (fullPass) {
      // Полный заход — можно смело снять «хвосты»: кампании окна, которых в
      // `cost` нет, реально перестали крутить, а не просто не дособрались.
      const windowRows = await prisma.ktCostDay.findMany({
        where: { date: { gte: fromDate, lte: toDate } },
        select: { id: true, ktToken: true, date: true },
      });
      const staleIds = windowRows
        .filter((r) => !present.has(`${r.ktToken}|${dayKey(r.date)}`))
        .map((r) => r.id);
      if (staleIds.length) await prisma.ktCostDay.deleteMany({ where: { id: { in: staleIds } } });
    }
  } catch (e) {
    result.problems.push(`Витрина расхода KtCostDay: ${(e as Error).message}`);
  }

  if (unmatchedCents > 0) {
    // Разбивка «кто течёт»: профили с самым большим непривязанным расходом
    // вперёд — у них в КТ нет связи объявление→кампания (обычно новая группа,
    // где ad_id не пишется в Sub ID 4). Так видно, какую группу настроить.
    const worst = [...unmatchedByHandle.entries()]
      .filter(([, c]) => c > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([h, c]) => {
        const total = c + (matchedByHandle.get(h) ?? 0);
        const pct = total > 0 ? Math.round((c / total) * 100) : 100;
        return `${h} $${Math.round(c / 100).toLocaleString('ru-RU')} (${pct}%)`;
      })
      .join(', ');
    result.problems.push(
      `ФБ: расход $${Math.round(unmatchedCents / 100).toLocaleString('ru-RU')} без кампании в КТ — объявление не нашлось ни по кликам, ни по токену в ссылке. ` +
        `Течёт у: ${worst}. У этих групп в кликах КТ не проставлен ad_id (Sub ID 4) или токен в ссылке не распознан.`,
    );
  }

  // Записи заливки в КТ строим из ДОЛГОВЕЧНОЙ витрины KtCostDay за окно, а НЕ из
  // текущего `cost` (возможного неполного захода). Заливка покампанийно ОЧИЩАЕТ
  // окно кампании и заливает заново то, что дали, — поэтому неполный пересчёт
  // (слетевшие токены, слабый матчинг старых дней) очищал и недоливал, и cost в
  // КТ проседал. Витрина upsert'ится и хранит накопленную картину по дням
  // (у слетевших токенов дни остаются от прошлых заходов), поэтому из неё КТ
  // получает ВЕСЬ известный расход, а не только собранный сейчас.
  const pushByCamp = new Map<string, CostEntry[]>();
  if (tracker) {
    try {
      const vitrina = await prisma.ktCostDay.findMany({
        where: { date: { gte: atMidnight(from), lte: atMidnight(to) }, spendCents: { gt: 0 } },
        select: { ktCampaignId: true, date: true, spendCents: true },
      });
      // Суммируем по (кампания, день): у одной кампании КТ бывает несколько
      // токенов, а в КТ расход ставим на campaign_id целиком.
      const byCampDay = new Map<string, number>();
      for (const r of vitrina) {
        if (!r.ktCampaignId) continue;
        const k = `${r.ktCampaignId}|${dayKey(r.date)}`;
        byCampDay.set(k, (byCampDay.get(k) ?? 0) + r.spendCents);
      }
      for (const [k, cents] of byCampDay) {
        const [campId, date] = k.split('|');
        const arr = pushByCamp.get(campId) ?? [];
        arr.push({ start_date: `${date} 00:00:00`, end_date: `${date} 23:59:59`, cost: cents / 100 });
        pushByCamp.set(campId, arr);
      }
    } catch (e) {
      result.problems.push(`Сбор витрины для заливки в КТ: ${(e as Error).message}`);
    }
  }

  // Заливаем посчитанный расход в сам Keitaro — чтобы cost встал рядом с
  // доходом в отчётах трекера и ROI считался уже внутри КТ.
  let pushed = { campaigns: 0, entries: 0, cents: 0, resp: '' };
  if (tracker) {
    pushed = await pushCostsToKeitaro(tracker, pushByCamp, from, to, result);
  }

  // Диагностика: одной строкой видно, дошёл ли расход до КТ и где он теряется.
  // Суммы до центов — расход по объявлению часто копеечный, целые доллары врут.
  const d = (cents: number) => `$${(cents / 100).toFixed(2)}`;
  result.info.push(
    `Расход ФБ: ${d(totalSpendCents)}. Залито в КТ: ${d(pushed.cents)} на ${pushed.campaigns} кампаний. ` +
      (nonUsdDays ? `Пропущено не-USD: ${d(nonUsdCents)}. ` : '') +
      (unmatchedCents ? `Без кампании в КТ: ${d(unmatchedCents)}. ` : '') +
      `Обнуляем окно покампанийно перед заливкой (чистим хвосты, без провала отчёта).` +
      (pushed.resp ? ` Ответ КТ: ${pushed.resp}` : ''),
  );

  return result;
}

/**
 * Отдаём расход в Keitaro — на campaign_id, обнуляя окно ПОКАМПАНИЙНО.
 *
 * Для каждой кампании: сперва обнуляем её cost за окно, потом сразу заливаем её
 * дни. Обнуление нужно, потому что заливка перезаписывает только дни С расходом,
 * а дни кампании БЕЗ открута сохраняют старую сумму (хвосты прошлых заходов) —
 * оттого в отчёте КТ набегает лишнее. Делаем обнуление+заливку кампании подряд,
 * а не «обнулить всё окно → потом заливать всё»: так кампания «пустая» лишь
 * миллисекунды между своими двумя запросами, и отчёт КТ не проваливается, даже
 * если открыть его в процессе. Фильтр по кликам (sub_id_4) в этом КТ недобирает,
 * поэтому льём на кампанию целиком. Успех метим `pushedAt` у строк KtCostDay.
 */
async function pushCostsToKeitaro(
  tracker: { baseUrl: string; apiKey: string },
  entriesByCamp: Map<string, CostEntry[]>,
  from: string,
  to: string,
  result: SyncResult,
): Promise<{ campaigns: number; entries: number; cents: number; resp: string }> {
  const CHUNK = 200; // не шлём тысячи записей одним запросом
  let campaigns = 0, entriesCount = 0, cents = 0;
  let sampleResp = '';

  // По каждой кампании: обнулить её окно → тут же залить её дни.
  for (const [campaignId, entries] of entriesByCamp) {
    if (entries.length === 0) continue;
    try {
      await clearCostsWindow(tracker.baseUrl, tracker.apiKey, [campaignId], from, to, SYNC_TZ);
      for (let i = 0; i < entries.length; i += CHUNK) {
        const resp = await updateCostsBulk(tracker.baseUrl, tracker.apiKey, campaignId, entries.slice(i, i + CHUNK), SYNC_TZ);
        if (!sampleResp) {
          try { sampleResp = JSON.stringify(resp).slice(0, 160); } catch { sampleResp = String(resp).slice(0, 160); }
        }
      }
      await prisma.ktCostDay.updateMany({
        where: { ktCampaignId: campaignId, date: { gte: atMidnight(from), lte: atMidnight(to) } },
        data: { pushedAt: new Date() },
      });
      campaigns += 1;
      entriesCount += entries.length;
      cents += entries.reduce((s, e) => s + Math.round(e.cost * 100), 0);
    } catch (e) {
      const why = e instanceof KeitaroError ? e.message : `Сбой: ${(e as Error).message}`;
      result.problems.push(`Keitaro cost (кампания ${campaignId}): ${why}`);
    }
  }

  return { campaigns, entries: entriesCount, cents, resp: sampleResp };
}

export async function syncAll(days = SYNC_DAYS) {
  // Расход раньше дохода: если у дня ещё нет строки, её заводит расход с
  // Brocard, а доход из Keitaro потом лишь дописывает revenue.
  const brocard = await syncBrocard(days);
  const kt = await syncKeitaro(days);
  const fb = await syncFacebook(days);
  return {
    touched: brocard.touched + kt.touched + fb.touched,
    skipped: brocard.skipped + kt.skipped + fb.skipped,
    orphanCents: kt.orphanCents,
    problems: [...brocard.problems, ...kt.problems, ...fb.problems],
    info: [...brocard.info, ...kt.info, ...fb.info],
  };
}
