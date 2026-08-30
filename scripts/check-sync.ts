/**
 * Проверка правила «синхронизация не спорит с человеком»:
 *   npx tsx scripts/check-sync.ts
 *
 * Ни базы, ни чужих API — только само правило. Цена ошибки в нём высокая:
 * затёртая руками цифра означает неверную зарплату, поэтому оно живёт
 * отдельным файлом и проверяется отдельно.
 */
import { mergeDay, type DayState } from '../src/lib/sync-rule';

let failed = 0;
function check(what: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed += 1;
  console.log(
    `${ok ? '✓' : '✗'} ${what}${ok ? '' : `\n    получили ${JSON.stringify(got)}\n    ждали    ${JSON.stringify(want)}`}`,
  );
}

const day = (over: Partial<DayState> = {}): DayState => ({
  spendNetCents: 0,
  revenueCents: 0,
  commissionBps: 450,
  spendSyncedCents: null,
  revenueSyncedCents: null,
  ...over,
});

// Пустую строку заполняем свободно.
check(
  'пустой расход заполняется',
  mergeDay(day(), { spendCents: 10_000 }).data.spendNetCents,
  10_000,
);

// Своё же прошлое значение переписываем: никто не вмешивался.
check(
  'своё прошлое значение обновляется',
  mergeDay(day({ spendNetCents: 10_000, spendSyncedCents: 10_000 }), { spendCents: 12_500 }).data
    .spendNetCents,
  12_500,
);

// Правку руками не трогаем.
const edited = mergeDay(day({ spendNetCents: 9_999, spendSyncedCents: 10_000 }), {
  spendCents: 44_000,
});
check('ручная правка расхода уцелела', [edited.data, edited.skipped], [{}, true]);

// Цифру, которую вписал человек до всякой синхронизации, тоже не трогаем.
check(
  'вписанное человеком до синхронизации уцелело',
  mergeDay(day({ spendNetCents: 7_000 }), { spendCents: 44_000 }).skipped,
  true,
);

// Расход и доход независимы: правка одного не мешает обновить другой.
const mixed = mergeDay(
  day({ spendNetCents: 9_999, spendSyncedCents: 10_000, revenueCents: 30_000, revenueSyncedCents: 30_000 }),
  { spendCents: 44_000, revenueCents: 31_000 },
);
check(
  'доход обновился, несмотря на правку расхода',
  [mixed.data.revenueCents, 'spendNetCents' in mixed.data, mixed.skipped],
  [31_000, false, true],
);

// Пришёл только доход — расход не занулился.
check(
  'приход одного дохода не трогает расход',
  'spendNetCents' in mergeDay(day({ spendNetCents: 10_000, spendSyncedCents: 10_000 }), { revenueCents: 500 }).data,
  false,
);

// Комиссия пересчитывается от нового чистого расхода, а не остаётся старой.
const gross = mergeDay(day(), { spendCents: 10_000 }).data.spendGrossCents;
check('расход с комиссией больше чистого', gross > 10_000, true);

// Ноль — тоже цифра: день, в который открутили ноль, должен записаться.
check('ноль записывается', mergeDay(day({ spendNetCents: 0 }), { spendCents: 0 }).data.spendNetCents, 0);

console.log(failed ? `\nПровалено проверок: ${failed}` : '\nВсе проверки прошли.');
process.exitCode = failed ? 1 : 0;
