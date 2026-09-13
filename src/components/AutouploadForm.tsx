'use client';

import { useRef, useState, useTransition } from 'react';
import { loadCabinetAssets, makePixel, runAutoupload, type UploadResult } from '@/app/actions/autoupload';
import type { Template } from './TemplateManager';

type Cabinet = { id: string; name: string; externalId: string; currency: string; owner: string };

const inp = 'h-9 w-full rounded-xl border border-line2 bg-sub px-3 text-[12.5px] text-soft';
const box = 'rounded-[14px] border border-line px-3.5 py-3';

/**
 * Автозалив: форма сборки кампании и запуск оркестратора. Страницы и пиксели
 * тянем живьём из выбранного кабинета; можно создать новый пиксель. Режим
 * запуска — пауза/актив/по расписанию; актив и расписание трогают реальные
 * деньги, поэтому требуют подтверждения.
 */
export default function AutouploadForm({ cabinets, templates }: { cabinets: Cabinet[]; templates: Template[] }) {
  const [pending, start] = useTransition();
  const [accountId, setAccountId] = useState('');
  const [assets, setAssets] = useState<{ pages: { id: string; name: string }[]; pixels: { id: string; name: string }[] } | null>(null);
  const [pageId, setPageId] = useState('');
  const [pixelId, setPixelId] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [mode, setMode] = useState<'paused' | 'active' | 'scheduled'>('paused');
  const [newPixel, setNewPixel] = useState('');
  const [fileCount, setFileCount] = useState(0);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [confirm, setConfirm] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const filesRef = useRef<HTMLInputElement>(null);

  const tpl = templates.find((t) => t.id === templateId) ?? null;

  const load = () => {
    if (!accountId || pending) return;
    setMsg(null);
    setAssets(null);
    setPageId('');
    setPixelId('');
    start(async () => {
      const r = await loadCabinetAssets(accountId);
      if (!r.ok) { setMsg({ ok: false, text: r.error ?? 'сбой' }); return; }
      setAssets({ pages: r.pages ?? [], pixels: r.pixels ?? [] });
    });
  };

  const addPixel = () => {
    if (!accountId || pending) return;
    start(async () => {
      const r = await makePixel(accountId, newPixel);
      if (!r.ok) { setMsg({ ok: false, text: r.error ?? 'сбой' }); return; }
      setAssets((a) => ({ pages: a?.pages ?? [], pixels: r.pixels ?? [] }));
      setNewPixel('');
      // Свежесозданный пиксель — обычно первый в списке; выберем его, если один новый.
      if (r.pixels && r.pixels.length) setPixelId(r.pixels[r.pixels.length - 1].id);
      setMsg({ ok: true, text: 'Пиксель создан.' });
    });
  };

  // Собираем FormData и запускаем. Для «актив/расписание» — только после подтверждения.
  const submit = () => {
    const form = formRef.current;
    if (!form || pending) return;
    if (!accountId) { setMsg({ ok: false, text: 'Выбери кабинет' }); return; }
    if (!templateId) { setMsg({ ok: false, text: 'Выбери шаблон гео' }); return; }
    if (!pageId) { setMsg({ ok: false, text: 'Выбери страницу — нажми «Подтянуть из кабинета»' }); return; }
    if (!pixelId) { setMsg({ ok: false, text: 'Выбери или создай пиксель' }); return; }
    const files = filesRef.current?.files;
    if (!files || files.length === 0) { setMsg({ ok: false, text: 'Добавь хотя бы одну картинку' }); return; }

    const fd = new FormData(form);
    fd.set('accountId', accountId);
    fd.set('templateId', templateId);
    fd.set('pageId', pageId);
    fd.set('pixelId', pixelId);
    fd.set('mode', mode);
    // datetime-local → ISO без двусмысленности пояса.
    if (mode === 'scheduled') {
      const raw = String(fd.get('startLocal') ?? '');
      const d = raw ? new Date(raw) : null;
      if (!d || Number.isNaN(d.getTime())) { setMsg({ ok: false, text: 'Укажи дату и время старта' }); return; }
      fd.set('startAt', d.toISOString());
    }
    // Картинки кладём под именем images (getAll на сервере).
    fd.delete('images');
    for (const f of Array.from(files)) fd.append('images', f);

    setMsg(null);
    setResult(null);
    setConfirm(false);
    start(async () => {
      const r = await runAutoupload(fd);
      setResult(r);
      if (!r.ok) setMsg({ ok: false, text: r.error ?? 'сбой заливки' });
      else setMsg({ ok: true, text: `Готово: ${r.adsCreated} объявлений создано.` });
    });
  };

  const onSubmitClick = () => {
    // Реальные деньги — просим подтверждение только на актив/расписание.
    if (mode === 'paused') { submit(); return; }
    if (!confirm) { setConfirm(true); return; }
    submit();
  };

  return (
    <div className="flex flex-col gap-3">
      <form ref={formRef} onSubmit={(e) => e.preventDefault()} className="flex flex-col gap-3">
        {/* Кабинет + подтянуть ассеты */}
        <div className={box}>
          <div className="text-[12.5px] font-semibold">1 · Кабинет</div>
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <select value={accountId} onChange={(e) => { setAccountId(e.target.value); setAssets(null); setPageId(''); setPixelId(''); }} className={`${inp} max-w-[340px]`}>
              <option value="">— выбери кабинет —</option>
              {cabinets.map((c) => (
                <option key={c.id} value={c.id}>{c.owner ? `${c.owner} · ` : ''}{c.name || c.externalId} · {c.currency}</option>
              ))}
            </select>
            <button type="button" onClick={load} disabled={!accountId || pending} className={`rounded-full border border-line2 bg-sub px-4 py-1.5 text-[12px] text-soft transition hover:border-sage hover:text-sage ${pending ? 'cursor-progress opacity-60' : ''} ${!accountId ? 'opacity-50' : ''}`}>
              {pending ? 'Читаю…' : assets ? 'Обновить ФП/пиксели' : 'Подтянуть из кабинета'}
            </button>
          </div>
        </div>

        {/* Страница + пиксель */}
        {assets ? (
          <div className={box}>
            <div className="text-[12.5px] font-semibold">2 · Страница и пиксель</div>
            <div className="mt-2.5 grid gap-2 sm:grid-cols-2">
              <div>
                <div className="mb-1 text-[11px] text-mute">Страница (ФП)</div>
                <select value={pageId} onChange={(e) => setPageId(e.target.value)} className={inp}>
                  <option value="">— страница —</option>
                  {assets.pages.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                {assets.pages.length === 0 ? <div className="mt-1 text-[11px] text-rust">Под токеном не видно ни одной страницы.</div> : null}
              </div>
              <div>
                <div className="mb-1 text-[11px] text-mute">Пиксель (событие из шаблона)</div>
                <select value={pixelId} onChange={(e) => setPixelId(e.target.value)} className={inp}>
                  <option value="">— пиксель —</option>
                  {assets.pixels.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input value={newPixel} onChange={(e) => setNewPixel(e.target.value)} placeholder="имя нового пикселя" className={`${inp} max-w-[220px]`} />
              <button type="button" onClick={addPixel} disabled={pending} className="rounded-full border border-line2 bg-sub px-3.5 py-1.5 text-[12px] text-soft transition hover:border-sage hover:text-sage">
                Создать пиксель
              </button>
            </div>
          </div>
        ) : null}

        {/* Шаблон гео + креатив */}
        <div className={box}>
          <div className="text-[12.5px] font-semibold">3 · Шаблон гео и объявление</div>
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} className={`${inp} max-w-[280px]`}>
              <option value="">— шаблон гео —</option>
              {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            {tpl ? (
              <span className="text-[11.5px] text-mute">
                {tpl.countries}{tpl.excluded ? ` (−${tpl.excluded})` : ''} · {tpl.ageMin}-{tpl.ageMax} · {tpl.event} · {tpl.cta}
              </span>
            ) : null}
          </div>
          <div className="mt-2 grid gap-2">
            <input name="campaignName" placeholder="Название кампании" className={inp} />
            <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
              <input name="link" placeholder="Ссылка на лендинг (https://…)" className={inp} />
              <input name="budget" type="text" inputMode="decimal" defaultValue={tpl ? (tpl.dailyBudgetCents / 100).toString() : ''} placeholder={tpl ? '$/день' : 'бюджет $/день'} className={`${inp} sm:w-[130px]`} />
            </div>
            <textarea name="message" placeholder="Текст объявления" rows={3} className="w-full rounded-xl border border-line2 bg-sub px-3 py-2 text-[12.5px] text-soft" />
            <div className="grid gap-2 sm:grid-cols-2">
              <input name="headline" placeholder="Заголовок (опц.)" className={inp} />
              <input name="description" placeholder="Описание под ссылкой (опц.)" className={inp} />
            </div>
            <input name="urlTags" placeholder="Метки к ссылке / sub_id (опц.): sub_id4={{ad.id}}" className={inp} />
          </div>
        </div>

        {/* Картинки */}
        <div className={box}>
          <div className="text-[12.5px] font-semibold">4 · Креативы</div>
          <p className="mt-1 text-[11px] text-mute">Каждая картинка — отдельное объявление в адсете (уникализация). До 20 штук.</p>
          <input
            ref={filesRef}
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => setFileCount(e.target.files?.length ?? 0)}
            className="mt-2 block w-full text-[12px] text-soft file:mr-3 file:rounded-full file:border file:border-line2 file:bg-sub file:px-4 file:py-1.5 file:text-[12px] file:text-soft hover:file:border-sage"
          />
          {fileCount > 0 ? <div className="mt-1.5 text-[11.5px] text-sage">выбрано картинок: {fileCount}</div> : null}
        </div>

        {/* Режим запуска */}
        <div className={box}>
          <div className="text-[12.5px] font-semibold">5 · Запуск</div>
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            {([['paused', 'На паузе'], ['active', 'Сразу в актив'], ['scheduled', 'По расписанию']] as const).map(([v, label]) => (
              <button
                key={v}
                type="button"
                onClick={() => { setMode(v); setConfirm(false); }}
                className={`rounded-full border px-3.5 py-1.5 text-[12px] transition ${mode === v ? 'border-sage bg-sage-t text-sage' : 'border-line2 bg-sub text-soft hover:border-sage'}`}
              >
                {label}
              </button>
            ))}
            {mode === 'scheduled' ? (
              <input name="startLocal" type="datetime-local" className={`${inp} max-w-[220px]`} />
            ) : null}
          </div>
          {mode !== 'paused' ? (
            <p className="mt-2 text-[11px] text-amber">Режим «{mode === 'active' ? 'сразу в актив' : 'по расписанию'}» запускает открут — это реальные деньги.</p>
          ) : (
            <p className="mt-2 text-[11px] text-dim">На паузе — безопасно: кампания создастся, но крутить не начнёт, пока не запустишь вручную.</p>
          )}
        </div>
      </form>

      {msg ? (
        <div className="rounded-[12px] border px-3 py-2 text-[12px]" style={msg.ok ? { borderColor: '#3c4d33', background: '#1c241a', color: '#b4c68c' } : { borderColor: '#5a3a2a', background: '#2c1f1a', color: '#ce6e58' }}>
          {msg.text}
        </div>
      ) : null}

      {confirm && mode !== 'paused' ? (
        <div className="flex flex-wrap items-center gap-2.5 rounded-[12px] border px-3 py-2.5 text-[12.5px]" style={{ borderColor: '#5a3a2a', background: '#241712' }}>
          <span className="text-soft">Залить и {mode === 'active' ? 'сразу запустить открут' : 'поставить в расписание'}? Это реальные деньги.</span>
          <div className="ml-auto flex items-center gap-2">
            <button type="button" onClick={submit} disabled={pending} className="rounded-full border border-sage px-3.5 py-1.5 text-[12px] text-sage transition hover:bg-sage-t">Подтвердить</button>
            <button type="button" onClick={() => setConfirm(false)} className="rounded-full border border-line2 px-3.5 py-1.5 text-[12px] text-mute transition hover:text-text">Отмена</button>
          </div>
        </div>
      ) : (
        <div>
          <button type="button" onClick={onSubmitClick} disabled={pending} className={`rounded-full border border-sage bg-sage-t px-5 py-2 text-[12.5px] font-medium text-sage transition hover:brightness-110 ${pending ? 'cursor-progress opacity-60' : ''}`}>
            {pending ? 'Заливаю…' : 'Залить'}
          </button>
        </div>
      )}

      {result?.log && result.log.length ? (
        <div className="rounded-[12px] border border-line bg-sub px-3.5 py-3">
          <div className="text-[11.5px] font-semibold text-mute">Журнал заливки</div>
          <pre className="mt-1.5 max-h-[280px] overflow-auto whitespace-pre-wrap text-[11.5px] leading-relaxed text-soft">{result.log.join('\n')}</pre>
        </div>
      ) : null}
    </div>
  );
}
