import 'server-only';
import { prisma } from './db';
import { dayKey } from './period';
import { grossUp } from './money';
import { mergeDay } from './sync-rule';
import { accountSpend, listAccounts, FbError } from './fb';
import { dailyRevenue, listCampaigns, KeitaroError } from './keitaro';

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

/** Сколько дней перетягиваем за раз. Facebook доуточняет цифры несколько
 *  часов, поэтому «вчера и всё» мало: последние дни переписываем заново. */
export const SYNC_DAYS = 4;

type Report = {
  buyerId: string;
  date: Date;
  spendCents?: number;
  revenueCents?: number;
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
    const spend = row.spendCents ?? 0;
    const revenue = row.revenueCents ?? 0;
    if (!spend && !revenue) return;

    const bps = 450;
    await prisma.dayReport.create({
      data: {
        buyerId: row.buyerId,
        date: row.date,
        source: 'Facebook',
        revenueCents: revenue,
        spendNetCents: spend,
        commissionBps: bps,
        spendGrossCents: grossUp(spend, bps),
        spendSyncedCents: row.spendCents ?? null,
        revenueSyncedCents: row.revenueCents ?? null,
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
 * Расход из Facebook. Каждый токен принадлежит баеру, поэтому всё, что видно
 * под ним, — расход этого баера; кабинеты внутри токена просто складываем.
 */
export async function syncFacebook(days = SYNC_DAYS): Promise<SyncResult> {
  const result = emptyResult();
  const { from, to } = daysBack(days);
  const tokens = await prisma.adToken.findMany({
    where: { enabled: true },
    include: { accounts: true, buyer: { select: { handle: true } } },
  });

  for (const token of tokens) {
    try {
      // Список кабинетов освежаем на каждом заходе: в BM их добавляют и
      // отключают, и узнавать об этом из тишины неоткуда.
      const seen = await listAccounts(token.token);
      for (const acc of seen) {
        await prisma.adAccount.upsert({
          where: { tokenId_externalId: { tokenId: token.id, externalId: acc.externalId } },
          update: { name: acc.name, currency: acc.currency },
          create: {
            tokenId: token.id,
            externalId: acc.externalId,
            name: acc.name,
            currency: acc.currency,
          },
        });
      }

      const accounts = await prisma.adAccount.findMany({
        where: { tokenId: token.id, enabled: true },
      });

      /** Расход по дням, сложенный по всем кабинетам этого баера. */
      const byDay = new Map<string, number>();
      for (const acc of accounts) {
        if (acc.currency !== 'USD') {
          // Перевод из другой валюты требует курса, которого у нас нет. Молча
          // посчитать не тот расход хуже, чем честно сказать и не считать.
          result.problems.push(
            `${token.buyer.handle}: кабинет ${acc.name || acc.externalId} в ${acc.currency} — считаем вручную`,
          );
          continue;
        }
        const spend = await accountSpend(token.token, acc.externalId, from, to);
        for (const d of spend) byDay.set(d.date, (byDay.get(d.date) ?? 0) + d.cents);
        await prisma.adAccount.update({
          where: { id: acc.id },
          data: { lastSpendAt: new Date() },
        });
      }

      for (const [iso, cents] of byDay) {
        await writeDay({ buyerId: token.buyerId, date: atMidnight(iso), spendCents: cents }, result);
      }

      await prisma.adToken.update({
        where: { id: token.id },
        data: { lastSyncAt: new Date(), lastError: '' },
      });
    } catch (e) {
      const why = e instanceof FbError ? e.message : `Сбой: ${(e as Error).message}`;
      result.problems.push(`${token.buyer.handle}: ${why}`);
      await prisma.adToken.update({
        where: { id: token.id },
        data: { lastError: why, lastSyncAt: new Date() },
      });
    }
  }

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

    const rows = await dailyRevenue(tracker.baseUrl, tracker.apiKey, from, to);

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

/** Оба источника разом — то, что дёргает кнопка в настройках и крон. */
export async function syncAll(days = SYNC_DAYS) {
  const fb = await syncFacebook(days);
  const kt = await syncKeitaro(days);
  return {
    touched: fb.touched + kt.touched,
    skipped: fb.skipped + kt.skipped,
    orphanCents: kt.orphanCents,
    problems: [...fb.problems, ...kt.problems],
  };
}
