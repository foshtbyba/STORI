import 'server-only';

import { prisma } from './db';
import { fbAccess, setAdStatus, setAdsetBudget, FbError, type FbNet } from './fb';
import { sleep, shuffle } from './pace';

/**
 * Движок автоправил. Крутит его наш крон (см. /api/sync?only=autorules) — именно
 * он, а не нативные правила Facebook, потому что только у нас есть ROI из Keitaro
 * (доход/расход по объявлению из FbAdDay.revenueCents).
 *
 * Правило = условие + действие, применяется к назначенным кабинетам (или сужено
 * до конкретной цели). Уровень (кампания/адсет/объявление) свой у каждого
 * правила. Метрики считаем из FbAd + FbAdDay агрегацией на нужный уровень.
 * Реактивация: то, что правило само поставило на паузу (или расписание), оно же
 * и включает обратно, когда условие ушло / наступило время «вкл».
 */

const TZ = process.env.SYNC_TZ || 'Europe/Moscow';

// Типы правил v1 (условные, на нашем движке). Расписание (dayparting) добавим
// отдельно нативными правилами FB. Константа живёт здесь, а не в 'use server'
// файле actions (там разрешены только async-экспорты).
export const AUTO_RULE_TYPES = [
  { type: 'roi_pause', label: 'ROI ниже порога → пауза' },
  { type: 'spend_no_conv_pause', label: 'Потрачено ≥ $X, 0 конверсий → пауза' },
  { type: 'cpa_pause', label: 'CPA выше порога → пауза' },
  { type: 'roi_scale', label: 'ROI выше порога → +% к бюджету' },
] as const;

export type AutoRuleParams = {
  roiMin?: number;        // % (100 = окупаемость), для roi_pause/roi_scale
  spendMinCents?: number; // минимальный расход, чтобы правило вообще срабатывало
  cpaMaxCents?: number;   // потолок цены результата, для cpa_pause
  stepPct?: number;       // на сколько поднять бюджет, roi_scale
  capCents?: number;      // потолок дневного бюджета, roi_scale
  cooldownMin?: number;   // антидребезг роста бюджета (мин), roi_scale
  offTime?: string;       // 'HH:MM' выключить, schedule
  onTime?: string;        // 'HH:MM' включить, schedule
  days?: number[];        // дни недели 1..7 (Пн..Вс), когда расписание активно; пусто = все дни
  reactivate?: boolean;   // возвращать из паузы, когда условие ушло (для pause-типов)
};

type Level = 'campaign' | 'adset' | 'ad';

/** Разбор текущего времени в нужной таймзоне: часы/минуты/день недели (1..7). */
function tzNow(now = new Date()): { minutes: number; weekday: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false,
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const hh = parseInt(get('hour'), 10) || 0;
  const mm = parseInt(get('minute'), 10) || 0;
  const wd = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[get('weekday')] ?? 0;
  return { minutes: hh * 60 + mm, weekday: wd };
}

/** 'HH:MM' → минуты от полуночи, либо null. */
function hm(v?: string): number | null {
  if (!v) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
  if (!m) return null;
  return (parseInt(m[1], 10) % 24) * 60 + (parseInt(m[2], 10) % 60);
}

/** Начало окна (windowDays календарных дней, включая сегодня) как UTC-дата дня. */
function windowCutoff(windowDays: number, now = new Date()): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const g = (t: string) => parseInt(parts.find((p) => p.type === t)?.value ?? '0', 10);
  const base = Date.UTC(g('year'), g('month') - 1, g('day'));
  return new Date(base - Math.max(0, windowDays - 1) * 86_400_000);
}

type Agg = { spend: number; leads: number; revenue: number };
type Target = {
  key: string;        // FB id цели (кампания/адсет/объявление)
  type: Level;
  name: string;
  budgetId: string;   // куда слать смену бюджета
  dailyBudget: number | null;
  agg: Agg;
};

/** Собрать цели уровня level с агрегированными метриками за окно. */
function buildTargets(
  level: Level,
  ads: { adId: string; name: string; adsetId: string; adsetName: string; campaignId: string; campaignName: string; budgetTargetId: string; dailyBudget: number | null }[],
  daysByAd: Map<string, Agg>,
): Map<string, Target> {
  const out = new Map<string, Target>();
  for (const a of ads) {
    const key = level === 'ad' ? a.adId : level === 'adset' ? a.adsetId : a.campaignId;
    if (!key) continue;
    let t = out.get(key);
    if (!t) {
      t = {
        key,
        type: level,
        name: level === 'ad' ? (a.name || a.adId) : level === 'adset' ? (a.adsetName || a.adsetId) : (a.campaignName || a.campaignId),
        budgetId: level === 'ad' ? (a.budgetTargetId || a.adsetId) : level === 'adset' ? a.adsetId : a.campaignId,
        dailyBudget: a.dailyBudget ?? null,
        agg: { spend: 0, leads: 0, revenue: 0 },
      };
      out.set(key, t);
    }
    if (t.dailyBudget == null && a.dailyBudget != null) t.dailyBudget = a.dailyBudget;
    const d = daysByAd.get(a.adId);
    if (d) { t.agg.spend += d.spend; t.agg.leads += d.leads; t.agg.revenue += d.revenue; }
  }
  return out;
}

function roiPct(a: Agg): number | null {
  if (a.spend <= 0) return null;
  return (a.revenue / a.spend) * 100;
}
function cpaCents(a: Agg): number | null {
  if (a.leads <= 0) return null;
  return a.spend / a.leads;
}

export type AutoRulesResult = { rules: number; actions: number; errors: number; info: string[] };

export async function runAutoRules(): Promise<AutoRulesResult> {
  const res: AutoRulesResult = { rules: 0, actions: 0, errors: 0, info: [] };
  const now = new Date();

  const rules = await prisma.autoRule.findMany({
    where: { enabled: true },
    include: { assignments: { where: { enabled: true } } },
  });
  res.rules = rules.length;
  if (!rules.length) return res;

  // Группируем работу по кабинету: назначение → (rule, assignment).
  type Job = { rule: (typeof rules)[number]; scopeFbId: string };
  const byAccount = new Map<string, Job[]>();
  for (const rule of rules) {
    for (const asg of rule.assignments) {
      const arr = byAccount.get(asg.adAccountId) ?? [];
      arr.push({ rule, scopeFbId: asg.scopeFbId });
      byAccount.set(asg.adAccountId, arr);
    }
  }

  for (const accId of shuffle([...byAccount.keys()])) {
    const jobs = byAccount.get(accId)!;
    const acc = await prisma.adAccount.findUnique({ where: { id: accId }, include: { adToken: true } });
    if (!acc || !acc.enabled) continue;
    if (acc.accountStatus !== 1) continue; // не активный кабинет — не трогаем
    const tok = acc.adToken;
    if (!tok.enabled) continue;
    if (tok.pausedUntil && tok.pausedUntil > now) continue;

    const { token: access, net } = fbAccess(tok.token, { cookiesJson: tok.cookiesJson, proxyUrl: tok.proxyUrl });

    // Метрики: грузим объявления кабинета и их дни за максимальное окно среди правил.
    const maxWindow = Math.max(1, ...jobs.map((j) => j.rule.windowDays || 1));
    const cutoff = windowCutoff(maxWindow, now);
    const ads = await prisma.fbAd.findMany({
      where: { adAccountId: accId },
      select: { id: true, adId: true, name: true, adsetId: true, adsetName: true, campaignId: true, campaignName: true, budgetTargetId: true, dailyBudget: true, status: true },
    });
    if (!ads.length) continue;
    const dayRows = await prisma.fbAdDay.findMany({
      where: { date: { gte: cutoff }, ad: { adAccountId: accId } },
      select: { adId: true, date: true, spendCents: true, leads: true, revenueCents: true },
    });
    // Индекс дней по внутреннему adId (FbAd.id) для срезов окна конкретного правила.
    const daysByRuleWindow = (windowDays: number): Map<string, Agg> => {
      const c = windowCutoff(windowDays, now).getTime();
      const m = new Map<string, Agg>();
      for (const r of dayRows) {
        if (r.date.getTime() < c) continue;
        const cur = m.get(r.adId) ?? { spend: 0, leads: 0, revenue: 0 };
        cur.spend += r.spendCents; cur.leads += r.leads; cur.revenue += r.revenueCents;
        m.set(r.adId, cur);
      }
      return m;
    };
    const statusByFbId = new Map<string, string>(); // для ad-уровня
    for (const a of ads) statusByFbId.set(a.adId, a.status);

    const act = async (
      job: Job, target: Target,
      action: 'pause' | 'start' | 'budget_up', reason: string,
      apply: () => Promise<unknown>,
    ) => {
      try {
        await apply();
        await sleep(600);
        res.actions += 1;
        await prisma.autoRuleLog.create({ data: {
          ruleId: job.rule.id, ruleName: job.rule.name, adAccountId: accId, accountName: acc.name || acc.externalId,
          targetType: target.type, targetFbId: target.key, targetName: target.name, action, reason,
        } });
      } catch (e) {
        res.errors += 1;
        res.info.push(`${acc.name || acc.externalId}/${job.rule.name}: ${e instanceof FbError ? e.message : (e as Error).message}`);
        await prisma.autoRuleLog.create({ data: {
          ruleId: job.rule.id, ruleName: job.rule.name, adAccountId: accId, accountName: acc.name || acc.externalId,
          targetType: target.type, targetFbId: target.key, targetName: target.name, action: 'error',
          reason: `${reason} — ${e instanceof FbError ? e.message : (e as Error).message}`,
        } });
      }
    };

    const getState = async (ruleId: string, targetFbId: string) =>
      prisma.autoRuleState.findUnique({ where: { ruleId_targetFbId: { ruleId, targetFbId } } });
    const setState = (ruleId: string, targetFbId: string, targetType: Level, data: { pausedByRule?: boolean; pausedBySchedule?: boolean; lastScaleAt?: Date }) =>
      prisma.autoRuleState.upsert({
        where: { ruleId_targetFbId: { ruleId, targetFbId } },
        update: data,
        create: { ruleId, targetFbId, targetType, ...data },
      });

    for (const job of jobs) {
      const { rule } = job;
      const level = (rule.level as Level) || 'ad';
      let params: AutoRuleParams = {};
      try { params = JSON.parse(rule.params || '{}'); } catch { params = {}; }

      const daysByAd = daysByRuleWindow(rule.windowDays || 1);
      let targets = [...buildTargets(level, ads, daysByAd).values()];
      // Сужение до конкретной цели, если задано в назначении.
      if (job.scopeFbId) targets = targets.filter((t) => t.key === job.scopeFbId);
      if (!targets.length) continue;

      const spendMin = params.spendMinCents ?? 0;

      for (const t of targets) {
        const st = await getState(rule.id, t.key);
        const knownActive = level === 'ad' ? statusByFbId.get(t.key) === 'ACTIVE' : undefined;

        // ── Расписание (dayparting) ─────────────────────────────────────────
        if (rule.type === 'schedule') {
          const off = hm(params.offTime); const on = hm(params.onTime);
          if (off == null || on == null) continue;
          const { minutes, weekday } = tzNow(now);
          const daysOk = !params.days?.length || params.days.includes(weekday);
          // Окно «выключено»: от off до on (с переходом через полночь).
          const inOff = daysOk && (off <= on ? (minutes >= off && minutes < on) : (minutes >= off || minutes < on));
          if (inOff) {
            const already = st?.pausedBySchedule;
            if (!already && (knownActive ?? true)) {
              await act(job, t, 'pause', `Расписание: выключено ${params.offTime}–${params.onTime}`, () => setAdStatus(access, t.key, 'PAUSED', net));
              await setState(rule.id, t.key, level, { pausedBySchedule: true });
            }
          } else if (st?.pausedBySchedule) {
            await act(job, t, 'start', `Расписание: включено (${params.onTime})`, () => setAdStatus(access, t.key, 'ACTIVE', net));
            await setState(rule.id, t.key, level, { pausedBySchedule: false });
          }
          continue;
        }

        // ── Рост бюджета по ROI ─────────────────────────────────────────────
        if (rule.type === 'roi_scale') {
          const roi = roiPct(t.agg);
          if (t.agg.spend < spendMin || roi == null) continue;
          if ((params.roiMin ?? 0) > 0 && roi < params.roiMin!) continue;
          const cooldownMs = (params.cooldownMin ?? 360) * 60_000;
          if (st?.lastScaleAt && now.getTime() - st.lastScaleAt.getTime() < cooldownMs) continue;
          const cur = t.dailyBudget ?? 0;
          if (cur <= 0 || !t.budgetId) continue;
          const step = params.stepPct ?? 20;
          const cap = params.capCents ?? 0;
          let next = Math.round(cur * (1 + step / 100));
          if (cap > 0) next = Math.min(next, cap);
          if (next <= cur) continue;
          await act(job, t, 'budget_up',
            `ROI ${roi.toFixed(0)}% ≥ ${params.roiMin ?? 0}% — бюджет $${(cur / 100).toFixed(2)}→$${(next / 100).toFixed(2)}`,
            () => setAdsetBudget(access, t.budgetId, next, net));
          await setState(rule.id, t.key, level, { lastScaleAt: new Date() });
          continue;
        }

        // ── Паузы по условию (+реактивация) ─────────────────────────────────
        let bad = false;
        let reason = '';
        if (rule.type === 'roi_pause') {
          const roi = roiPct(t.agg);
          if (t.agg.spend >= spendMin && roi != null && roi < (params.roiMin ?? 0)) {
            bad = true; reason = `ROI ${roi.toFixed(0)}% < ${params.roiMin ?? 0}% при расходе $${(t.agg.spend / 100).toFixed(2)}`;
          }
        } else if (rule.type === 'spend_no_conv_pause') {
          if (t.agg.spend >= spendMin && t.agg.leads === 0) {
            bad = true; reason = `Расход $${(t.agg.spend / 100).toFixed(2)} ≥ $${(spendMin / 100).toFixed(2)}, конверсий 0`;
          }
        } else if (rule.type === 'cpa_pause') {
          const cpa = cpaCents(t.agg);
          if (t.agg.spend >= spendMin && cpa != null && cpa > (params.cpaMaxCents ?? 0)) {
            bad = true; reason = `CPA $${(cpa / 100).toFixed(2)} > $${((params.cpaMaxCents ?? 0) / 100).toFixed(2)}`;
          }
        } else {
          continue; // неизвестный тип
        }

        if (bad) {
          const alreadyPaused = st?.pausedByRule;
          if (!alreadyPaused && (knownActive ?? true)) {
            await act(job, t, 'pause', reason, () => setAdStatus(access, t.key, 'PAUSED', net));
            await setState(rule.id, t.key, level, { pausedByRule: true });
          }
        } else if (params.reactivate && st?.pausedByRule) {
          // Условие ушло (напр. долетел лид / ROI выправился) — возвращаем то, что
          // сами и выключили.
          await act(job, t, 'start', 'Условие ушло — реактивация', () => setAdStatus(access, t.key, 'ACTIVE', net));
          await setState(rule.id, t.key, level, { pausedByRule: false });
        }
      }
    }
  }

  return res;
}
