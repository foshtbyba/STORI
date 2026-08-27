'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { parseImport, impliedBps } from '@/lib/import';
import { usd } from '@/lib/money';
import { importDays } from '@/app/actions/days';
import DateField from './DateField';
import { Panel, PanelHead, Sub } from './ui';
import { IconList } from './icons';

const SAMPLE = 'sko 30800 - 20900 + 21800\nnomad 41200 - 27400 + 28600';

/**
 * Accepts the format the team already writes. Parsing happens in the browser so
 * the preview updates as you type; only the resolved rows go to the server.
 */
export default function QuickImport({
  today,
  defaultBps,
  knownHandles,
}: {
  today: string;
  defaultBps: number;
  knownHandles: string[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [text, setText] = useState('');
  const [date, setDate] = useState(today);
  const [message, setMessage] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);

  const known = useMemo(() => new Set(knownHandles.map((h) => h.toLowerCase())), [knownHandles]);
  const rows = useMemo(() => parseImport(text, defaultBps), [text, defaultBps]);
  const usable = rows.filter((r) => !r.error && known.has(r.handle));

  function run() {
    setMessage(null);
    start(async () => {
      const result = await importDays(
        date,
        usable.map((r) => ({
          handle: r.handle,
          revenueCents: r.revenueCents,
          spendNetCents: r.spendNetCents,
          spendGrossCents: r.spendGrossCents,
        })),
      );
      if (!result.ok) {
        setMessage({ tone: 'err', text: result.error });
        return;
      }
      const skipped = result.skipped?.length ? ` Пропущено: ${result.skipped.join(', ')}.` : '';
      setMessage({ tone: 'ok', text: `Импортировано дней: ${result.imported}.${skipped}` });
      setText('');
      router.refresh();
    });
  }

  return (
    <Panel className="p-6">
      <PanelHead
        icon={<IconList color="#b4c68c" />}
        tint="bg-sage-t"
        title="Быстрый ввод"
        aside={<span className="text-[12.5px] text-mute">твой формат</span>}
        right={
          <span className="w-[168px]">
            <DateField value={date} onChange={setDate} />
          </span>
        }
      />
      <p className="mt-3.5 text-[12.5px] leading-relaxed text-mute">
        Вставь строки как обычно пишешь. Третье число — расход уже с комиссией; если его нет, посчитаем
        по ставке платёжки ({(defaultBps / 100).toFixed(2)}%).
      </p>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={5}
        spellCheck={false}
        placeholder={SAMPLE}
        className="n mt-3.5 w-full resize-y rounded-[18px] bg-sub p-4 text-[13.5px] leading-[2] outline-none placeholder:text-dim"
      />

      {rows.length > 0 ? (
        <>
          <div className="mt-4 grid grid-cols-[1fr_repeat(4,1fr)] pb-2">
            <span className="lab">Баер</span>
            <span className="lab text-right">Доход</span>
            <span className="lab text-right">Спенд</span>
            <span className="lab text-right">С комис.</span>
            <span className="lab text-right">Профит</span>
          </div>
          {rows.map((r, i) => {
            const unknown = !r.error && !known.has(r.handle);
            const bps = impliedBps(r);
            return (
              <div key={i} className="grid grid-cols-[1fr_repeat(4,1fr)] items-center border-t border-line py-2.5">
                <span className="text-[13.5px] font-semibold">
                  {r.handle || '—'}
                  {r.error ? <span className="ml-2 text-[11px] text-rust">{r.error}</span> : null}
                  {unknown ? <span className="ml-2 text-[11px] text-rust">нет такого баера</span> : null}
                </span>
                <span className="n text-right text-[13px] text-soft">{usd(r.revenueCents)}</span>
                <span className="n text-right text-[13px] text-mute">{usd(r.spendNetCents)}</span>
                <span
                  className="n text-right text-[13px]"
                  style={{ color: r.grossDerived ? '#ce6e58' : '#8a8a8a' }}
                  title={bps !== null ? `комиссия ${(bps / 100).toFixed(2)}%` : undefined}
                >
                  {usd(r.spendGrossCents)}
                </span>
                <span
                  className="n text-right text-[14px] font-semibold"
                  style={{ color: r.profitCents >= 0 ? '#b4c68c' : '#ce6e58' }}
                >
                  {usd(r.profitCents, { sign: true })}
                </span>
              </div>
            );
          })}
          {rows.some((r) => r.grossDerived && !r.error) ? (
            <Sub className="mt-3.5 border-l-[3px] border-rust px-4 py-3 text-[12.5px] leading-relaxed text-soft">
              У части строк третьего числа нет — комиссия посчитана по ставке платёжки. Значения
              подсвечены, проверь перед импортом.
            </Sub>
          ) : null}
        </>
      ) : null}

      {message ? (
        <p
          className={`mt-4 rounded-[14px] px-4 py-3 text-[12.5px] ${
            message.tone === 'ok' ? 'bg-sage-t text-sage' : 'bg-rust-t text-rust'
          }`}
        >
          {message.text}
        </p>
      ) : null}

      <div className="mt-4 flex gap-3">
        <button
          type="button"
          onClick={run}
          disabled={pending || usable.length === 0}
          className="flex-1 rounded-full bg-sage py-3 text-[13px] font-semibold text-bg transition hover:opacity-90 disabled:opacity-40"
        >
          {pending ? 'Импортирую…' : `Импортировать ${usable.length} дн.`}
        </button>
        <button
          type="button"
          onClick={() => { setText(''); setMessage(null); }}
          className="rounded-full bg-sub px-5 py-3 text-[13px] text-mute transition hover:text-soft"
        >
          Очистить
        </button>
      </div>
    </Panel>
  );
}
