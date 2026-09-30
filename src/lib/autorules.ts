import 'server-only';

import { prisma } from './db';
import { fbAccess, setAdStatus, setAdsetBudget, FbError, fbErrorKind } from './fb';
import { sleep, shuffle, humanPause, fbCooldownUntil } from './pace';
import { grossUp, DEFAULT_COMMISSION_BPS } from './money';

// Пол кулдауна для пауза/старт: даже если у правила нет своего кулдауна, не даём
// одному правилу дёргать одну и ту же цель чаще, чем раз в столько минут — чтобы
// не жечь API и не устраивать пинг-понг «пауза↔старт» между заходами крона.
const PAUSE_START_COOLDOWN_MIN = 15;

/**
 * Движок автоправил по модели FB/FBtool: гибкий конструктор
 *   «частота + период статы + уровень + какие статусы брать + действие + условия».
 *
 * Крутит его наш крон (/api/sync?only=autorules) — только он видит ROI/доход из
 * Keitaro (FbAdDay.revenueCents). «Без условий» (только время/частота) = чистое
 * расписание (dayparting). Реактивация — отдельное правило на включение с
 * условием (напр. статус=Остановленные, действие=Запустить, лидов > 0).
 */

const TZ = process.env.SYNC_TZ || 'Europe/Moscow';

export type Level = 'campaign' | 'adset' | 'ad';
export type Op = '>' | '<' | '=';
export type Condition = { metric: string; op: Op; value: number };
export type ActionKind = 'pause' | 'start' | 'budget_daily';
export type StatusFilter = 'active' | 'paused' | 'any';
export type Frequency = 'halfhour' | 'hour' | 'midnight' | 'hour_at';
export type ActionParams = { mode?: 'pct' | 'set'; value?: number; capCents?: number; floorCents?: number; cooldownMin?: number };

/** Каталог метрик для условий (то, что реально считаем из FbAd/FbAdDay). */
export const METRICS: { key: string; label: string; unit: '$' | '%' | '' }[] = [
  { key: 'spend', label: 'Расход', unit: '$' },
  { key: 'revenue', label: 'Доход (Keitaro)', unit: '$' },
  { key: 'roi', label: 'ROI', unit: '%' },
  { key: 'results', label: 'Результаты (лиды)', unit: '' },
  { key: 'cpa', label: 'Цена результата (CPA)', unit: '$' },
  { key: 'impressions', label: 'Показы', unit: '' },
  { key: 'clicks', label: 'Клики по ссылке', unit: '' },
  { key: 'ctr', label: 'CTR', unit: '%' },
  { key: 'cpc', label: 'CPC', unit: '$' },
  { key: 'cpm', label: 'CPM', unit: '$' },
];

export const ACTIONS: { key: ActionKind; label: string }[] = [
  { key: 'pause', label: 'Остановить' },
  { key: 'start', label: 'Запустить' },
  { key: 'budget_daily', label: 'Изменить дневной бюджет' },
];

export const FREQUENCIES: { key: Frequency; label: string }[] = [
  { key: 'halfhour', label: 'Каждые полчаса' },
  { key: 'hour', label: 'Каждый час' },
  { key: 'midnight', label: 'Каждую полночь' },
  { key: 'hour_at', label: 'В конкретный час' },
];

export const WINDOWS: { key: string; label: string }[] = [
  { key: 'all', label: 'Всё время' },
  { key: 'today', label: 'Сегодня' },
  { key: 'yesterday', label: 'Вчера' },
  { key: 'last2', label: 'Последние 2 дня' },
  { key: 'last3', label: 'Последние 3 дня' },
  { key: 'last7', label: 'Последние 7 дней' },
  { key: 'last14', label: 'Последние 14 дней' },
  { key: 'last28', label: 'Последние 28 дней' },
  { key: 'last30', label: 'Последние 30 дней' },
  { key: 'month', label: 'Текущий месяц' },
];

/** Разбор времени в TZ: минуты от полуночи + день недели (1..7). */
function tzNow(now = new Date()): { minutes: number; hour: number } {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(now);
  const hh = parseInt(p.find((x) => x.type === 'hour')?.value ?? '0', 10) || 0;
  const mm = parseInt(p.find((x) => x.type === 'minute')?.value ?? '0', 10) || 0;
  return { minutes: hh * 60 + mm, hour: hh };
}

/** UTC-полночь календарного дня TZ, со сдвигом на daysAgo дней назад. */
function tzDayStart(daysAgo: number, now = new Date()): Date {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const g = (t: string) => parseInt(p.find((x) => x.type === t)?.value ?? '0', 10);
  return new Date(Date.UTC(g('year'), g('month') - 1, g('day')) - daysAgo * 86_400_000);
}

/** Диапазон дат окна для фильтра FbAdDay.date. */
function windowRange(kind: string, now = new Date()): { gte?: Date; lt?: Date } {
  switch (kind) {
    case 'all': return {};
    case 'today': return { gte: tzDayStart(0, now) };
    case 'yesterday': return { gte: tzDayStart(1, now), lt: tzDayStart(0, now) };
    case 'last2': return { gte: tzDayStart(1, now) };
    case 'last3': return { gte: tzDayStart(2, now) };
    case 'last7': return { gte: tzDayStart(6, now) };
    case 'last14': return { gte: tzDayStart(13, now) };
    case 'last28': return { gte: tzDayStart(27, now) };
    case 'last30': return { gte: tzDayStart(29, now) };
    case 'month': {
      const p = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit' }).formatToParts(now);
      const g = (t: string) => parseInt(p.find((x) => x.type === t)?.value ?? '0', 10);
      return { gte: new Date(Date.UTC(g('year'), g('month') - 1, 1)) };
    }
    default: return { gte: tzDayStart(0, now) };
  }
}

type Agg = { spend: number; impressions: number; clicks: number; leads: number; revenue: number };
const emptyAgg = (): Agg => ({ spend: 0, impressions: 0, clicks: 0, leads: 0, revenue: 0 });

/**
 * Значение метрики в НАТУРАЛЬНЫХ единицах: $ / % / штуки. null — посчитать нельзя.
 *
 * ВАЖНО: денежные метрики считаем от GROSS-расхода (с комиссией баера), как на
 * дашборде (queries.ts: ROI = профит/spendGross·100, где профит = доход −
 * spendGross). `a.spend` из FbAdDay — это СЫРОЙ (net) расход ФБ; gross передаём
 * снаружи. Иначе «ROI 20%» в правиле значил бы не то, что видит баер на экране.
 */
function metricValue(key: string, a: Agg, grossSpendCents: number): number | null {
  const gross = grossSpendCents / 100;
  switch (key) {
    case 'spend': return gross;
    case 'revenue': return a.revenue / 100;
    // ROI по ПРИБЫЛИ (как дашборд), а не ROAS: (доход − расход_gross)/расход_gross.
    case 'roi': return grossSpendCents > 0 ? ((a.revenue - grossSpendCents) / grossSpendCents) * 100 : null;
    case 'results': return a.leads;
    case 'cpa': return a.leads > 0 ? gross / a.leads : null;
    case 'impressions': return a.impressions;
    case 'clicks': return a.clicks;
    case 'ctr': return a.impressions > 0 ? (a.clicks / a.impressions) * 100 : null;
    case 'cpc': return a.clicks > 0 ? gross / a.clicks : null;
    case 'cpm': return a.impressions > 0 ? (gross / a.impressions) * 1000 : null;
    default: return null;
  }
}

function cmp(op: Op, a: number, b: number): boolean {
  if (op === '>') return a > b;
  if (op === '<') return a < b;
  return Math.abs(a - b) < 1e-9;
}

/** Гейт по частоте: пора ли гонять правило. */
function isDue(freq: Frequency, hourAt: number | null, lastRunAt: Date | null, now = new Date()): boolean {
  const { hour, minutes } = tzNow(now);
  const sinceMin = lastRunAt ? (now.getTime() - lastRunAt.getTime()) / 60_000 : Infinity;
  if (freq === 'halfhour') return sinceMin >= 29;
  if (freq === 'hour') return sinceMin >= 59;
  if (freq === 'midnight') return minutes < 60 && sinceMin >= 120; // в первый час суток, раз
  if (freq === 'hour_at') return hourAt != null && hour === hourAt && sinceMin >= 50;
  return sinceMin >= 29;
}

export type AutoRulesResult = { rules: number; ran: number; actions: number; errors: number; info: string[] };

export async function runAutoRules(force = false): Promise<AutoRulesResult> {
  const res: AutoRulesResult = { rules: 0, ran: 0, actions: 0, errors: 0, info: [] };
  const now = new Date();

  const rules = await prisma.autoRule.findMany({ where: { enabled: true }, include: { assignments: { where: { enabled: true } } } });
  res.rules = rules.length;

  // Только те правила, которым пора и у которых есть куда применяться.
  const due = rules.filter((r) => r.assignments.length && (force || isDue(r.frequency as Frequency, r.hourAt, r.lastRunAt, now)));
  if (!due.length) return res;

  // Группируем по кабинету.
  type Job = { rule: (typeof rules)[number]; scopeFbId: string };
  const byAccount = new Map<string, Job[]>();
  for (const rule of due) {
    for (const asg of rule.assignments) {
      const arr = byAccount.get(asg.adAccountId) ?? [];
      arr.push({ rule, scopeFbId: asg.scopeFbId });
      byAccount.set(asg.adAccountId, arr);
    }
  }

  const ranRuleIds = new Set<string>();

  for (const accId of shuffle([...byAccount.keys()])) {
    const jobs = byAccount.get(accId)!;
    const acc = await prisma.adAccount.findUnique({ where: { id: accId }, include: { adToken: true } });
    if (!acc || !acc.enabled || acc.accountStatus !== 1) continue;
    const tok = acc.adToken;
    if (!tok.enabled) continue;
    if (tok.pausedUntil && tok.pausedUntil > now) continue;
    const { token: access, net } = fbAccess(tok.token, { cookiesJson: tok.cookiesJson, proxyUrl: tok.proxyUrl });
    // Комиссия для gross-расхода — та же глобальная, что синк применяет к расходу
    // объявлений (см. sync.ts: const bps = DEFAULT_COMMISSION_BPS).
    const bps = DEFAULT_COMMISSION_BPS;

    // Состояния правил этого каба — для антидребезга (lastActionAt) и безопасной
    // реактивации (включаем обратно только то, что ПРАВИЛО и выключило).
    const stateRows = await prisma.autoRuleState.findMany({ where: { ruleId: { in: jobs.map((j) => j.rule.id) } } });
    const stateBy = new Map(stateRows.map((s) => [`${s.ruleId}::${s.targetFbId}`, s]));
    const pausedByRuleTargets = new Set(stateRows.filter((s) => s.pausedByRule).map((s) => s.targetFbId));

    const ads = await prisma.fbAd.findMany({
      where: { adAccountId: accId },
      select: { id: true, adId: true, name: true, status: true, adsetId: true, adsetName: true, campaignId: true, campaignName: true, budgetTargetId: true, dailyBudget: true },
    });
    if (!ads.length) continue;

    // Дни за самое широкое окно среди правил этого каба.
    const kinds = jobs.map((j) => j.rule.windowKind);
    const gteCandidates = kinds.map((k) => windowRange(k, now).gte).filter(Boolean) as Date[];
    const widestGte = kinds.includes('all') ? undefined : (gteCandidates.length ? new Date(Math.min(...gteCandidates.map((d) => d.getTime()))) : tzDayStart(0, now));
    const dayRows = await prisma.fbAdDay.findMany({
      where: { ad: { adAccountId: accId }, ...(widestGte ? { date: { gte: widestGte } } : {}) },
      select: { adId: true, date: true, spendCents: true, impressions: true, clicks: true, leads: true, revenueCents: true },
    });

    const log = async (job: Job, target: { type: Level; key: string; name: string }, action: string, reason: string) => {
      await prisma.autoRuleLog.create({ data: {
        ruleId: job.rule.id, ruleName: job.rule.name, adAccountId: accId, accountName: acc.name || acc.externalId,
        targetType: target.type, targetFbId: target.key, targetName: target.name, action, reason,
      } });
    };

    let stopAccount = false; // троттлинг/бан ФБ на этом токене — прекращаем долбить
    for (const job of jobs) {
      if (stopAccount) break;
      ranRuleIds.add(job.rule.id);
      const { rule } = job;
      const level = (rule.level as Level) || 'adset';
      const range = windowRange(rule.windowKind, now);
      let conditions: Condition[] = [];
      try { conditions = JSON.parse(rule.conditions || '[]'); } catch { conditions = []; }
      let ap: ActionParams = {};
      try { ap = JSON.parse(rule.actionParams || '{}'); } catch { ap = {}; }
      const useConds = rule.conditionsEnabled && conditions.length > 0;

      // Собираем цели уровня level + агрегируем метрики за окно правила.
      type T = { key: string; name: string; budgetId: string; dailyBudget: number | null; agg: Agg; anyActive: boolean };
      const targets = new Map<string, T>();
      const inWindow = (d: Date) => (!range.gte || d >= range.gte) && (!range.lt || d < range.lt);
      const dayByAd = new Map<string, Agg>();
      for (const r of dayRows) {
        if (!inWindow(r.date)) continue;
        const cur = dayByAd.get(r.adId) ?? emptyAgg();
        cur.spend += r.spendCents; cur.impressions += r.impressions; cur.clicks += r.clicks; cur.leads += r.leads; cur.revenue += r.revenueCents;
        dayByAd.set(r.adId, cur);
      }
      for (const a of ads) {
        const key = level === 'ad' ? a.adId : level === 'adset' ? a.adsetId : a.campaignId;
        if (!key) continue;
        let t = targets.get(key);
        if (!t) {
          t = {
            key,
            name: level === 'ad' ? (a.name || a.adId) : level === 'adset' ? (a.adsetName || a.adsetId) : (a.campaignName || a.campaignId),
            budgetId: level === 'ad' ? (a.budgetTargetId || a.adsetId) : level === 'adset' ? a.adsetId : a.campaignId,
            dailyBudget: a.dailyBudget ?? null, agg: emptyAgg(), anyActive: false,
          };
          targets.set(key, t);
        }
        if (t.dailyBudget == null && a.dailyBudget != null) t.dailyBudget = a.dailyBudget;
        if (a.status === 'ACTIVE') t.anyActive = true;
        const d = dayByAd.get(a.adId);
        if (d) { t.agg.spend += d.spend; t.agg.impressions += d.impressions; t.agg.clicks += d.clicks; t.agg.leads += d.leads; t.agg.revenue += d.revenue; }
      }

      let list = [...targets.values()];
      if (job.scopeFbId) list = list.filter((t) => t.key === job.scopeFbId);

      // Фильтр по статусу («какие статусы брать»).
      if (rule.statusFilter === 'active') list = list.filter((t) => t.anyActive);
      else if (rule.statusFilter === 'paused') list = list.filter((t) => !t.anyActive);

      for (const t of list) {
        if (stopAccount) break;
        const grossSpend = grossUp(t.agg.spend, bps);
        // Проверка условий (И-логика). «Без условий» → срабатывает всегда (по времени).
        let reason = 'по расписанию';
        if (useConds) {
          let allOk = true; const parts: string[] = [];
          for (const c of conditions) {
            const v = metricValue(c.metric, t.agg, grossSpend);
            if (v == null || !cmp(c.op, v, c.value)) { allOk = false; break; }
            const m = METRICS.find((x) => x.key === c.metric);
            parts.push(`${m?.label ?? c.metric} ${c.op} ${c.value}${m?.unit === '$' ? '$' : m?.unit === '%' ? '%' : ''}`);
          }
          if (!allOk) continue;
          reason = parts.join(' И ');
        }

        const st = stateBy.get(`${rule.id}::${t.key}`);
        const setState = (data: { pausedByRule?: boolean; lastActionAt?: Date }) =>
          prisma.autoRuleState.upsert({
            where: { ruleId_targetFbId: { ruleId: rule.id, targetFbId: t.key } },
            update: data, create: { ruleId: rule.id, targetFbId: t.key, targetType: level, ...data },
          });

        try {
          if (rule.action === 'pause') {
            // Антидребезг: одно правило не паузит одну цель чаще кулдауна.
            const cdMin = Math.max(ap.cooldownMin ?? 0, PAUSE_START_COOLDOWN_MIN);
            if (st?.lastActionAt && now.getTime() - st.lastActionAt.getTime() < cdMin * 60_000) continue;
            await setAdStatus(access, t.key, 'PAUSED', net);
            await setState({ pausedByRule: true, lastActionAt: new Date() });
            pausedByRuleTargets.add(t.key);
            await log(job, { type: level, key: t.key, name: t.name }, 'pause', reason);
          } else if (rule.action === 'start') {
            // Включаем обратно ТОЛЬКО то, что выключило правило (не спорим с человеком).
            if (!pausedByRuleTargets.has(t.key)) continue;
            const cdMin = Math.max(ap.cooldownMin ?? 0, PAUSE_START_COOLDOWN_MIN);
            if (st?.lastActionAt && now.getTime() - st.lastActionAt.getTime() < cdMin * 60_000) continue;
            await setAdStatus(access, t.key, 'ACTIVE', net);
            // Снимаем флаг «выключено правилом» у всех правил по этой цели.
            await prisma.autoRuleState.updateMany({ where: { targetFbId: t.key }, data: { pausedByRule: false } });
            await setState({ pausedByRule: false, lastActionAt: new Date() });
            pausedByRuleTargets.delete(t.key);
            await log(job, { type: level, key: t.key, name: t.name }, 'start', reason);
          } else if (rule.action === 'budget_daily') {
            if (!t.budgetId) continue;
            const cur = t.dailyBudget ?? 0;
            // Антидребезг бюджета: пол 60 мин, чтобы pct-рост без потолка не разгонялся.
            const cdMin = Math.max(ap.cooldownMin ?? 0, 60);
            if (st?.lastActionAt && now.getTime() - st.lastActionAt.getTime() < cdMin * 60_000) continue;
            let next: number;
            if (ap.mode === 'set') next = Math.max(0, Math.round(ap.value ?? 0));
            else next = Math.round(cur * (1 + (ap.value ?? 0) / 100)); // pct (может быть отрицательным)
            if (ap.capCents && ap.capCents > 0) next = Math.min(next, ap.capCents);
            if (ap.floorCents && ap.floorCents > 0) next = Math.max(next, ap.floorCents);
            if (next <= 0 || next === cur) continue;
            await setAdsetBudget(access, t.budgetId, next, net);
            await setState({ lastActionAt: new Date() });
            const dir = next > cur ? 'budget_up' : 'budget_down';
            await log(job, { type: level, key: t.key, name: t.name }, dir, `${reason} — бюджет $${(cur / 100).toFixed(2)}→$${(next / 100).toFixed(2)}`);
          } else {
            continue;
          }
          res.actions += 1;
          await sleep(800);
        } catch (e) {
          res.errors += 1;
          const kind = fbErrorKind(e);
          res.info.push(`${acc.name || acc.externalId}/${rule.name}: ${e instanceof FbError ? e.message : (e as Error).message}`);
          await log(job, { type: level, key: t.key, name: t.name }, 'error', `${reason} — ${e instanceof FbError ? e.message : (e as Error).message}`);
          // Троттлинг/бан ФБ — НЕ долбим дальше этот токен: ставим кулдаун и уходим.
          if (kind === 'throttle' || kind === 'blocked') {
            const until = fbCooldownUntil(kind, now);
            if (until) await prisma.adToken.update({ where: { id: tok.id }, data: { pausedUntil: until } }).catch(() => {});
            stopAccount = true;
            break;
          }
        }
      }
    }

    // Пауза между кабинетами — как в синке, чтобы не выглядеть роботом для ФБ.
    await humanPause();
  }

  // Отметить прогон (гейт по частоте) для тех правил, что реально гонялись.
  if (ranRuleIds.size) {
    await prisma.autoRule.updateMany({ where: { id: { in: [...ranRuleIds] } }, data: { lastRunAt: now } });
    res.ran = ranRuleIds.size;
  }

  return res;
}
