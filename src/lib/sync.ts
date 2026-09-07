import 'server-only';
import { prisma } from './db';
import { dayKey } from './period';
import { grossUp, ceilDollars, DEFAULT_COMMISSION_BPS } from './money';
import { mergeDay } from './sync-rule';
import { accountSpend, listAccounts, listCampaigns as listFbCampaigns, fbAccess, extractFbToken, FbError, fbErrorKind } from './fb';
import { extractTokenFromCookies } from './fb-engine';
import { humanPause, shuffle, pool, FB_COOLDOWN_HOURS, FB_CONCURRENCY } from './pace';
import { dailyRevenue, listCampaigns, KeitaroError } from './keitaro';
import { dailySpend, listTeams, BrocardError } from './brocard';

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
  /** Доход, которому не нашлось баера: группа не привязана. */
  orphanCents: number;
};

const emptyResult = (): SyncResult => ({ touched: 0, skipped: 0, problems: [], orphanCents: 0 });

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
 * Запись одного дня. Обновляем только то, что пришло: расход и доход приезжают
 * из разных мест и в разное время, и синхронизация Facebook не должна занулять
 * доход, которого она не видела.
 *
 * Само правило «не спорить с человеком» живёт в sync-rule.ts — отдельно от
 * базы и чужих API, чтобы его можно было прогнать проверкой.
 */
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
async function refreshTokenFromCookies(t: {
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
  await prisma.adToken.update({ where: { id: t.id }, data: { token: blob } });
  t.token = blob;
  return true;
}

export async function syncFacebook(days = SYNC_DAYS): Promise<SyncResult> {
  const result = emptyResult();
  const { from, to } = daysBack(days);
  const now = new Date();

  // Пропускаем токены на кулдауне: после троттлинга или «подозрительной
  // активности» аккаунт должен остыть, а не получать запросы по расписанию.
  const all = await prisma.adToken.findMany({
    where: { enabled: true },
    include: { accounts: true, buyer: { select: { handle: true } } },
  });
  const tokens = shuffle(all.filter((t) => !t.pausedUntil || t.pausedUntil <= now));

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
        await prisma.adAccount.upsert({
          where: { tokenId_externalId: { tokenId: token.id, externalId: acc.externalId } },
          update: {
            name: acc.name,
            currency: acc.currency,
            accountStatus: acc.accountStatus,
            disableReason: acc.disableReason,
          },
          create: {
            tokenId: token.id,
            externalId: acc.externalId,
            name: acc.name,
            currency: acc.currency,
            accountStatus: acc.accountStatus,
            disableReason: acc.disableReason,
          },
        });
      }

      // Порядок кабинетов внутри токена — вперемешку: одинаковый обход из раза
      // в раз тоже читается как автомат.
      const accounts = shuffle(
        await prisma.adAccount.findMany({ where: { tokenId: token.id, enabled: true } }),
      );

      for (const acc of accounts) {
        // Пауза перед каждым запросом расхода: главный рычаг против чекпоинта.
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

        // Кампании тянем только в глубоком заходе (раз в сутки): меняются они
        // редко, а каждый лишний запрос — риск чекпоинта. Пауза перед ним, как
        // и перед расходом.
        if (days >= 7) {
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
          }
          // Убираем кампании, которых больше нет под кабинетом (удалены).
          await prisma.fbCampaign.deleteMany({
            where: { adAccountId: acc.id, campaignId: { notIn: liveIds.length ? liveIds : ['__none__'] } },
          });
        }
      }

      await prisma.adToken.update({
        where: { id: token.id },
        data: { lastSyncAt: new Date(), lastError: '', pausedUntil: null },
      });
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
      const pausedUntil = scary
        ? new Date(now.getTime() + FB_COOLDOWN_HOURS * 3600_000)
        : token.pausedUntil ?? null;
      const note = scary
        ? `${why} — токен на паузе до ${pausedUntil?.toLocaleString('ru-RU')}, чтобы не словить чекпоинт`
        : why;

      result.problems.push(`${token.buyer.handle}: ${note}`);
      await prisma.adToken.update({
        where: { id: token.id },
        data: { lastError: note, lastSyncAt: new Date(), pausedUntil },
      });
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

    const rows = await dailyRevenue(tracker.baseUrl, tracker.apiKey, from, to, SYNC_TZ);

    /** Доход по «баер + день»: у баера обычно несколько кампаний. */
    const byBuyerDay = new Map<string, number>();
    for (const row of rows) {
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

    const rows = await dailySpend(config.apiKey, from, to, SYNC_TZ);

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
  };
}
