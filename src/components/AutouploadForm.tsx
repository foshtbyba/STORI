'use client';

import { useMemo, useRef, useState, useTransition } from 'react';
import { loadCabinetAssets, makePixel, runAutoupload, type UploadResult } from '@/app/actions/autoupload';
import type { Template } from './TemplateManager';

type Cabinet = { id: string; name: string; externalId: string; currency: string; group: string };
type Asset = { pages: { id: string; name: string }[]; pixels: { id: string; name: string }[] };

const inp = 'h-9 w-full rounded-xl border border-line2 bg-sub px-3 text-[12.5px] text-soft outline-none focus:border-sage';
const box = 'rounded-[16px] border border-line bg-panel/40 px-4 py-4 sm:px-5';
const stepBadge = 'flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sage-t text-[12px] font-semibold text-sage';

const DEFAULT_TAGS = 'ad_id={{ad.id}}&fbpx={{pixel}}&account_id={{account.id}}&campaign_id={{campaign.id}}';

/**
 * Автозалив: сборка кампании и запуск на один или несколько кабинетов сразу.
 * Гео/возраст/бюджет — из шаблона; страница и пиксель у каждого кабинета свои,
 * поэтому выбираются построчно. Креатив (текст, картинки, ссылка, режим) общий.
 * Заливаем по кабинетам по очереди, чтобы не ловить троттлинг Меты.
 */
export default function AutouploadForm({ cabinets, templates }: { cabinets: Cabinet[]; templates: Template[] }) {
  const [pending, start] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [assets, setAssets] = useState<Record<string, Asset>>({});
  const [pageByAcc, setPageByAcc] = useState<Record<string, string>>({});
  const [pixelByAcc, setPixelByAcc] = useState<Record<string, string>>({});
  const [newPixelByAcc, setNewPixelByAcc] = useState<Record<string, string>>({});
  const [templateId, setTemplateId] = useState('');
  const [mode, setMode] = useState<'paused' | 'active' | 'scheduled'>('paused');
  const [fileCount, setFileCount] = useState(0);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [results, setResults] = useState<Record<string, UploadResult>>({});
  const [openLog, setOpenLog] = useState<string>('');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const filesRef = useRef<HTMLInputElement>(null);

  const tpl = templates.find((t) => t.id === templateId) ?? null;
  const byId = useMemo(() => new Map(cabinets.map((c) => [c.id, c])), [cabinets]);

  // Кабинеты группируем по владельцу/профилю (SKO/MPR…).
  const grouped = useMemo(() => {
    const map = new Map<string, Cabinet[]>();
    for (const c of cabinets) {
      const arr = map.get(c.group) ?? [];
      arr.push(c);
      map.set(c.group, arr);
    }
    return [...map.entries()];
  }, [cabinets]);

  const selectedList = cabinets.filter((c) => selected.has(c.id));
  const loadedNeeded = selectedList.filter((c) => !assets[c.id]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleGroup = (list: Cabinet[], on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const c of list) { if (on) next.add(c.id); else next.delete(c.id); }
      return next;
    });
  };

  // Подтянуть ФП и пиксели для всех выбранных кабинетов, у кого их ещё нет.
  const loadAssets = () => {
    if (pending || selectedList.length === 0) return;
    setMsg(null);
    start(async () => {
      const targets = loadedNeeded.length ? loadedNeeded : selectedList;
      const entries = await Promise.all(
        targets.map(async (c) => [c.id, await loadCabinetAssets(c.id)] as const),
      );
      const nextAssets: Record<string, Asset> = { ...assets };
      const nextPage = { ...pageByAcc };
      const nextPixel = { ...pixelByAcc };
      const fails: string[] = [];
      for (const [id, r] of entries) {
        if (!r.ok) { fails.push(byId.get(id)?.name || id); continue; }
        nextAssets[id] = { pages: r.pages ?? [], pixels: r.pixels ?? [] };
        // Единственный вариант — выбираем сразу, чтобы не кликать руками.
        if ((r.pages?.length ?? 0) === 1) nextPage[id] = r.pages![0].id;
        if ((r.pixels?.length ?? 0) === 1) nextPixel[id] = r.pixels![0].id;
      }
      setAssets(nextAssets);
      setPageByAcc(nextPage);
      setPixelByAcc(nextPixel);
      if (fails.length) setMsg({ ok: false, text: `Не подтянулись: ${fails.join(', ')}` });
    });
  };

  const addPixel = (accId: string) => {
    if (pending) return;
    const name = newPixelByAcc[accId] ?? '';
    start(async () => {
      const r = await makePixel(accId, name);
      if (!r.ok) { setMsg({ ok: false, text: r.error ?? 'сбой создания пикселя' }); return; }
      setAssets((a) => ({ ...a, [accId]: { pages: a[accId]?.pages ?? [], pixels: r.pixels ?? [] } }));
      if (r.pixels?.length) setPixelByAcc((p) => ({ ...p, [accId]: r.pixels![r.pixels!.length - 1].id }));
      setNewPixelByAcc((n) => ({ ...n, [accId]: '' }));
      setMsg({ ok: true, text: 'Пиксель создан.' });
    });
  };

  const validate = (): string | null => {
    if (selectedList.length === 0) return 'Выбери хотя бы один кабинет';
    if (!templateId) return 'Выбери шаблон гео';
    const form = formRef.current;
    if (!form) return 'Форма не готова';
    const link = String(new FormData(form).get('link') ?? '').trim();
    if (!/^https?:\/\//i.test(link)) return 'Ссылка на лендинг должна начинаться с http(s)://';
    if (!String(new FormData(form).get('message') ?? '').trim()) return 'Текст объявления пустой';
    const files = filesRef.current?.files;
    if (!files || files.length === 0) return 'Добавь хотя бы одну картинку';
    for (const c of selectedList) {
      if (!assets[c.id]) return `Подтяни ФП/пиксели: ${c.name || c.externalId}`;
      if (!pageByAcc[c.id]) return `Выбери страницу: ${c.name || c.externalId}`;
      if (!pixelByAcc[c.id]) return `Выбери/создай пиксель: ${c.name || c.externalId}`;
    }
    return null;
  };

  const submit = () => {
    const form = formRef.current;
    if (!form || pending) return;
    const err = validate();
    if (err) { setMsg({ ok: false, text: err }); return; }
    const files = Array.from(filesRef.current!.files!);
    const base = new FormData(form);
    let startAt = '';
    if (mode === 'scheduled') {
      const raw = String(base.get('startLocal') ?? '');
      const d = raw ? new Date(raw) : null;
      if (!d || Number.isNaN(d.getTime())) { setMsg({ ok: false, text: 'Укажи дату и время старта' }); return; }
      startAt = d.toISOString();
    }

    setMsg(null);
    setResults({});
    setConfirm(false);
    start(async () => {
      const total = selectedList.length;
      setProgress({ done: 0, total });
      let okCount = 0;
      for (let i = 0; i < selectedList.length; i += 1) {
        const c = selectedList[i];
        const fd = new FormData();
        for (const [k, v] of base) if (typeof v === 'string') fd.set(k, v);
        fd.set('accountId', c.id);
        fd.set('templateId', templateId);
        fd.set('pageId', pageByAcc[c.id]);
        fd.set('pixelId', pixelByAcc[c.id]);
        fd.set('mode', mode);
        if (startAt) fd.set('startAt', startAt);
        fd.delete('images');
        for (const f of files) fd.append('images', f);
        const r = await runAutoupload(fd);
        if (r.ok) okCount += 1;
        setResults((prev) => ({ ...prev, [c.id]: r }));
        setProgress({ done: i + 1, total });
      }
      setProgress(null);
      setMsg({ ok: okCount === total, text: `Залито: ${okCount}/${total} кабинетов.` });
    });
  };

  const onSubmitClick = () => {
    const err = validate();
    if (err) { setMsg({ ok: false, text: err }); return; }
    if (mode === 'paused') { submit(); return; }
    if (!confirm) { setConfirm(true); return; }
    submit();
  };

  const allLoaded = selectedList.length > 0 && selectedList.every((c) => assets[c.id]);

  return (
    <div className="flex flex-col gap-3">
      <form ref={formRef} onSubmit={(e) => e.preventDefault()} className="flex flex-col gap-3">
        {/* 1 · Кабинеты (мультивыбор) */}
        <div className={box}>
          <div className="flex items-center gap-2.5">
            <span className={stepBadge}>1</span>
            <span className="text-[13px] font-semibold">Кабинеты</span>
            <span className="ml-auto text-[12px] text-mute">выбрано {selectedList.length} из {cabinets.length}</span>
          </div>
          <div className="mt-3 max-h-[240px] overflow-auto rounded-[12px] border border-line">
            {grouped.map(([group, list]) => {
              const allOn = list.every((c) => selected.has(c.id));
              return (
                <div key={group} className="border-b border-line last:border-0">
                  <div className="sticky top-0 flex items-center justify-between bg-sub px-3 py-1.5">
                    <span className="text-[11.5px] font-semibold text-amber">{group}</span>
                    <button type="button" onClick={() => toggleGroup(list, !allOn)} className="text-[11px] text-mute transition hover:text-sage">
                      {allOn ? 'снять все' : 'выбрать все'}
                    </button>
                  </div>
                  {list.map((c) => (
                    <label key={c.id} className="flex cursor-pointer items-center gap-2.5 px-3 py-1.5 text-[12.5px] transition hover:bg-sub/60">
                      <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} className="accent-[#b4c68c]" />
                      <span className="min-w-0 flex-1 truncate text-soft">{c.name || c.externalId}</span>
                      <span className="shrink-0 text-[11px] text-dim">{c.currency}</span>
                    </label>
                  ))}
                </div>
              );
            })}
          </div>
          {selectedList.length > 0 ? (
            <button type="button" onClick={loadAssets} disabled={pending} className={`mt-3 rounded-full border border-line2 bg-sub px-4 py-1.5 text-[12px] text-soft transition hover:border-sage hover:text-sage ${pending ? 'cursor-progress opacity-60' : ''}`}>
              {pending ? 'Читаю кабинеты…' : allLoaded ? 'Обновить ФП/пиксели' : `Подтянуть ФП и пиксели (${selectedList.length})`}
            </button>
          ) : null}
        </div>

        {/* 2 · Страница и пиксель у каждого кабинета */}
        {selectedList.some((c) => assets[c.id]) ? (
          <div className={box}>
            <div className="flex items-center gap-2.5">
              <span className={stepBadge}>2</span>
              <span className="text-[13px] font-semibold">Страница и пиксель по кабинетам</span>
            </div>
            <div className="mt-3 flex flex-col gap-2.5">
              {selectedList.map((c) => {
                const a = assets[c.id];
                if (!a) return (
                  <div key={c.id} className="rounded-[12px] border border-line px-3 py-2 text-[12px] text-mute">
                    {c.name || c.externalId} — не подтянут, нажми «Подтянуть».
                  </div>
                );
                return (
                  <div key={c.id} className="rounded-[12px] border border-line px-3 py-2.5">
                    <div className="text-[12px] font-medium text-soft">{c.name || c.externalId}</div>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      <select value={pageByAcc[c.id] ?? ''} onChange={(e) => setPageByAcc((p) => ({ ...p, [c.id]: e.target.value }))} className={inp}>
                        <option value="">— страница (ФП) —</option>
                        {a.pages.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                      <select value={pixelByAcc[c.id] ?? ''} onChange={(e) => setPixelByAcc((p) => ({ ...p, [c.id]: e.target.value }))} className={inp}>
                        <option value="">— пиксель —</option>
                        {a.pixels.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <input value={newPixelByAcc[c.id] ?? ''} onChange={(e) => setNewPixelByAcc((n) => ({ ...n, [c.id]: e.target.value }))} placeholder="имя нового пикселя" className={`${inp} max-w-[200px]`} />
                      <button type="button" onClick={() => addPixel(c.id)} disabled={pending} className="rounded-full border border-line2 bg-sub px-3 py-1.5 text-[11.5px] text-soft transition hover:border-sage hover:text-sage">
                        + пиксель
                      </button>
                      {a.pages.length === 0 ? <span className="text-[11px] text-rust">нет страниц под токеном</span> : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        {/* 3 · Шаблон + объявление */}
        <div className={box}>
          <div className="flex items-center gap-2.5">
            <span className={stepBadge}>3</span>
            <span className="text-[13px] font-semibold">Шаблон гео и объявление</span>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} className={`${inp} max-w-[280px]`}>
              <option value="">— шаблон гео —</option>
              {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            {tpl ? (
              <span className="rounded-full border border-line bg-sub px-3 py-1 text-[11.5px] text-mute">
                {tpl.countries}{tpl.excluded ? ` (−${tpl.excluded})` : ''} · {tpl.ageMin}-{tpl.ageMax} · {tpl.event} · {tpl.cta}
              </span>
            ) : null}
          </div>
          <div className="mt-2.5 grid gap-2">
            <input name="campaignName" placeholder="Название кампании (оно же у адсета и объявлений)" className={inp} />
            <div className="grid gap-2 sm:grid-cols-[1fr_140px]">
              <input name="link" placeholder="Ссылка на лендинг (https://…)" className={inp} />
              <input name="budget" type="text" inputMode="decimal" defaultValue={tpl ? (tpl.dailyBudgetCents / 100).toString() : ''} placeholder="$/день" className={inp} />
            </div>
            <textarea name="message" placeholder="Текст объявления" rows={3} className="w-full rounded-xl border border-line2 bg-sub px-3 py-2 text-[12.5px] text-soft outline-none focus:border-sage" />
            <div className="grid gap-2 sm:grid-cols-2">
              <input name="headline" placeholder="Заголовок (опц.)" className={inp} />
              <input name="description" placeholder="Описание под ссылкой (опц.)" className={inp} />
            </div>
            <div>
              <input name="urlTags" defaultValue={DEFAULT_TAGS} className={inp} />
              <p className="mt-1 text-[11px] text-dim">Метки к ссылке. <code className="text-mute">{'{{pixel}}'}</code> заменится на пиксель кабинета; <code className="text-mute">{'{{ad.id}}'}</code>, <code className="text-mute">{'{{campaign.id}}'}</code>, <code className="text-mute">{'{{account.id}}'}</code> подставит ФБ.</p>
            </div>
          </div>
        </div>

        {/* 4 · Креативы */}
        <div className={box}>
          <div className="flex items-center gap-2.5">
            <span className={stepBadge}>4</span>
            <span className="text-[13px] font-semibold">Креативы</span>
            {fileCount > 0 ? <span className="ml-auto text-[12px] text-sage">выбрано {fileCount}</span> : null}
          </div>
          <p className="mt-1.5 text-[11px] text-mute">Каждая картинка — отдельное объявление в адсете. До 20 штук. Авто-улучшения Меты отключаем при создании.</p>
          <input
            ref={filesRef}
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => setFileCount(e.target.files?.length ?? 0)}
            className="mt-2 block w-full text-[12px] text-soft file:mr-3 file:rounded-full file:border file:border-line2 file:bg-sub file:px-4 file:py-1.5 file:text-[12px] file:text-soft hover:file:border-sage"
          />
        </div>

        {/* 5 · Запуск */}
        <div className={box}>
          <div className="flex items-center gap-2.5">
            <span className={stepBadge}>5</span>
            <span className="text-[13px] font-semibold">Запуск</span>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {([['paused', 'На паузе'], ['active', 'Сразу в актив'], ['scheduled', 'По расписанию']] as const).map(([v, label]) => (
              <button key={v} type="button" onClick={() => { setMode(v); setConfirm(false); }} className={`rounded-full border px-3.5 py-1.5 text-[12px] transition ${mode === v ? 'border-sage bg-sage-t text-sage' : 'border-line2 bg-sub text-soft hover:border-sage'}`}>
                {label}
              </button>
            ))}
          </div>
          {/* Дату держим на своей строке, чтобы ряд кнопок не дёргался при выборе. */}
          {mode === 'scheduled' ? <input name="startLocal" type="datetime-local" className={`${inp} mt-2 max-w-[240px]`} /> : null}
          {mode !== 'paused' ? (
            <p className="mt-2 text-[11px] text-amber">Режим «{mode === 'active' ? 'сразу в актив' : 'по расписанию'}» запускает открут — реальные деньги на {selectedList.length || 0} кабинетах.</p>
          ) : (
            <p className="mt-2 text-[11px] text-dim">На паузе — безопасно: создастся, но крутить не начнёт.</p>
          )}
        </div>
      </form>

      {msg ? (
        <div className="rounded-[12px] border px-3 py-2 text-[12px]" style={msg.ok ? { borderColor: '#3c4d33', background: '#1c241a', color: '#b4c68c' } : { borderColor: '#5a3a2a', background: '#2c1f1a', color: '#ce6e58' }}>
          {msg.text}
        </div>
      ) : null}

      {progress ? (
        <div className="text-[12px] text-mute">Заливаю… {progress.done}/{progress.total}</div>
      ) : null}

      {confirm && mode !== 'paused' ? (
        <div className="flex flex-wrap items-center gap-2.5 rounded-[12px] border px-3 py-2.5 text-[12.5px]" style={{ borderColor: '#5a3a2a', background: '#241712' }}>
          <span className="text-soft">Залить на {selectedList.length} кабинетов и {mode === 'active' ? 'сразу запустить открут' : 'поставить в расписание'}? Реальные деньги.</span>
          <div className="ml-auto flex items-center gap-2">
            <button type="button" onClick={submit} disabled={pending} className="rounded-full border border-sage px-3.5 py-1.5 text-[12px] text-sage transition hover:bg-sage-t">Подтвердить</button>
            <button type="button" onClick={() => setConfirm(false)} className="rounded-full border border-line2 px-3.5 py-1.5 text-[12px] text-mute transition hover:text-text">Отмена</button>
          </div>
        </div>
      ) : (
        <div>
          <button type="button" onClick={onSubmitClick} disabled={pending} className={`rounded-full border border-sage bg-sage-t px-6 py-2.5 text-[13px] font-medium text-sage transition hover:brightness-110 ${pending ? 'cursor-progress opacity-60' : ''}`}>
            {pending ? 'Заливаю…' : `Залить${selectedList.length ? ` на ${selectedList.length}` : ''}`}
          </button>
        </div>
      )}

      {/* Результаты по кабинетам */}
      {Object.keys(results).length ? (
        <div className="flex flex-col gap-1.5">
          {selectedList.filter((c) => results[c.id]).map((c) => {
            const r = results[c.id];
            const open = openLog === c.id;
            return (
              <div key={c.id} className="rounded-[12px] border border-line bg-sub px-3.5 py-2.5">
                <div className="flex items-center gap-2 text-[12.5px]">
                  <span className={r.ok ? 'text-sage' : 'text-rust'}>{r.ok ? '✓' : '✗'}</span>
                  <span className="min-w-0 flex-1 truncate text-soft">{c.name || c.externalId}</span>
                  <span className="shrink-0 text-[11.5px] text-mute">{r.ok ? `${r.adsCreated} объявл.` : (r.error ?? 'ошибка')}</span>
                  {r.log?.length ? (
                    <button type="button" onClick={() => setOpenLog(open ? '' : c.id)} className="shrink-0 text-[11px] text-mute transition hover:text-sage">
                      {open ? 'скрыть' : 'журнал'}
                    </button>
                  ) : null}
                </div>
                {open && r.log?.length ? (
                  <pre className="mt-2 max-h-[220px] overflow-auto whitespace-pre-wrap text-[11px] leading-relaxed text-dim">{r.log.join('\n')}</pre>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
