'use client';

import { useMemo, useRef, useState, useTransition } from 'react';
import { loadCabinetAssets, makePixel, makePage, runAutoupload, type UploadResult } from '@/app/actions/autoupload';
import TemplatePicker from './TemplatePicker';
import type { Template } from './TemplateManager';

type Cabinet = { id: string; name: string; externalId: string; currency: string; group: string };
type Asset = { pages: { id: string; name: string }[]; pixels: { id: string; name: string }[] };
type Mode = 'paused' | 'active' | 'midnight';

const inp = 'h-9 w-full rounded-xl border border-line2 bg-sub px-3 text-[12.5px] text-soft outline-none focus:border-sage';
const box = 'rounded-[16px] border border-line bg-panel/40 px-4 py-4 sm:px-5';
const DEFAULT_TAGS_VIDEO = 'ad_id={{ad.id}}&fbpx={{pixel}}&fb_pixel={{fbpixel}}&account_id={{account.id}}&campaign_id={{campaign.id}}';

function nextMoscowMidnight(): string {
  const now = new Date();
  const msk = new Date(now.getTime() + 3 * 3600_000);
  return new Date(Date.UTC(msk.getUTCFullYear(), msk.getUTCMonth(), msk.getUTCDate() + 1, 0, 0, 0) - 3 * 3600_000).toISOString();
}

/**
 * Видео-залив (этап 1): один основной ролик файлом на выбранный кабинет.
 * По умолчанию НА ПАУЗЕ — для проверки в Ads Manager. Языки (доп-ролики из пака)
 * подключаются вторым этапом. Пиксель fb_pixel вводится вручную (метка в ссылке).
 */
export default function VideoUpload({ cabinets, templates }: { cabinets: Cabinet[]; templates: Template[] }) {
  // SKO первым, остальные по алфавиту — как в основном заливе.
  const owners = useMemo(() => {
    const uniq = [...new Set(cabinets.map((c) => c.group))];
    return uniq.sort((a, b) => (a === 'SKO' ? -1 : b === 'SKO' ? 1 : a.localeCompare(b)));
  }, [cabinets]);
  const [owner, setOwner] = useState(owners[0] ?? '');
  const [cabId, setCabId] = useState('');
  const [asset, setAsset] = useState<Asset | null>(null);
  const [pageId, setPageId] = useState('');
  const [pixelId, setPixelId] = useState('');
  const [newPixel, setNewPixel] = useState('');
  const [newPage, setNewPage] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [campaignName, setCampaignName] = useState('');
  const [link, setLink] = useState('');
  const [budget, setBudget] = useState('');
  const [message, setMessage] = useState('');
  const [headline, setHeadline] = useState('');
  const [description, setDescription] = useState('');
  const [fbPixel, setFbPixel] = useState('');
  const [mode, setMode] = useState<Mode>('paused');
  const [video, setVideo] = useState<File | null>(null);
  const [result, setResult] = useState<(UploadResult & { label: string }) | null>(null);
  const [msg, setMsg] = useState('');
  const [openLog, setOpenLog] = useState(false);
  const [pending, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  const ownerCabs = cabinets.filter((c) => c.group === owner);
  const cab = cabinets.find((c) => c.id === cabId) ?? null;
  const tpl = templates.find((t) => t.id === templateId) ?? null;

  const pull = () => {
    if (!cabId) { setMsg('Выбери кабинет'); return; }
    setMsg('');
    start(async () => {
      const r = await loadCabinetAssets(cabId);
      if (!r.ok) { setMsg(r.error || 'Не подтянулись ФП/пиксели'); return; }
      setAsset({ pages: r.pages ?? [], pixels: r.pixels ?? [] });
      if ((r.pages?.length ?? 0) === 1) setPageId(r.pages![0].id);
      if ((r.pixels?.length ?? 0) === 1) setPixelId(r.pixels![0].id);
    });
  };

  const addPixel = () => {
    if (!cabId || !newPixel.trim()) return;
    start(async () => {
      const r = await makePixel(cabId, newPixel.trim());
      if (!r.ok) { setMsg(r.error || 'Пиксель не создан'); return; }
      setAsset((a) => ({ pages: a?.pages ?? [], pixels: r.pixels ?? [] }));
      setNewPixel('');
    });
  };

  const addPage = () => {
    if (!cabId || !newPage.trim()) return;
    start(async () => {
      const r = await makePage(cabId, newPage.trim());
      if (!r.ok) { setMsg(r.error || 'Страница не создана'); return; }
      setAsset((a) => ({ pages: r.pages ?? [], pixels: a?.pixels ?? [] }));
      setNewPage('');
    });
  };

  const fire = () => {
    setMsg(''); setResult(null);
    if (!cab) return setMsg('Выбери кабинет');
    if (!templateId) return setMsg('Выбери шаблон гео');
    if (!pageId) return setMsg('Выбери страницу (ФП)');
    if (!pixelId) return setMsg('Выбери/создай пиксель');
    if (!video) return setMsg('Добавь ролик (видеофайл)');
    if (!/^https?:\/\//i.test(link.trim())) return setMsg('Ссылка должна начинаться с http(s)://');
    if (!message.trim()) return setMsg('Текст объявления пустой');
    if (!fbPixel.trim()) return setMsg('Впиши номер fb_pixel');
    start(async () => {
      const fd = new FormData();
      fd.set('accountId', cabId);
      fd.set('templateId', templateId);
      fd.set('pageId', pageId);
      fd.set('pixelId', pixelId);
      fd.set('campaignName', campaignName.trim());
      fd.set('link', link.trim());
      fd.set('budget', budget.trim());
      fd.set('message', message.trim());
      fd.set('headline', headline.trim());
      fd.set('description', description.trim());
      fd.set('urlTags', DEFAULT_TAGS_VIDEO);
      fd.set('manualPixel', fbPixel.trim());
      fd.set('mode', mode);
      if (mode === 'midnight') fd.set('startAt', nextMoscowMidnight());
      fd.set('video', video);
      const r = await runAutoupload(fd);
      setResult({ ...r, label: `${cab.name || cab.externalId} · ${campaignName || 'без имени'}` });
      setMsg(r.ok ? 'Готово.' : (r.error ?? 'Ошибка'));
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-[12px] border border-amber/40 bg-amber-t/30 px-3.5 py-2.5 text-[11.5px] text-amber">
        Видео-метод, этап 1: один основной ролик на кабинет. По умолчанию заливается <b>на паузе</b> — проверь в Ads Manager. Доп-языки из пака подключим следующим этапом.
      </div>

      {/* Кабинет + ФП/пиксель */}
      <div className={box}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-semibold">Кабинет</span>
          <div className="flex flex-wrap gap-1.5">
            {owners.map((o) => (
              <button key={o} type="button" onClick={() => { setOwner(o); setCabId(''); setAsset(null); }} className={`rounded-full border px-3 py-1 text-[12px] transition ${o === owner ? 'border-amber bg-amber-t text-amber' : 'border-line2 bg-sub text-soft hover:border-amber'}`}>{o}</button>
            ))}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select value={cabId} onChange={(e) => { setCabId(e.target.value); setAsset(null); }} className={`${inp} max-w-[320px]`}>
            <option value="">— выбери кабинет —</option>
            {ownerCabs.map((c) => <option key={c.id} value={c.id}>{c.name || c.externalId}{c.name && c.name !== c.externalId ? ` · ${c.externalId}` : ''}</option>)}
          </select>
          <button type="button" onClick={pull} disabled={pending || !cabId} className={`rounded-full border border-line2 bg-sub px-4 py-1.5 text-[12px] text-soft transition hover:border-sage hover:text-sage ${pending || !cabId ? 'opacity-50' : ''}`}>Подтянуть ФП и пиксели</button>
        </div>
        {asset ? (
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <div>
              <div className="lab mb-1">Страница (ФП)</div>
              <select value={pageId} onChange={(e) => setPageId(e.target.value)} className={inp}>
                <option value="">—</option>
                {asset.pages.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <div className="mt-1.5 flex items-center gap-2">
                <input value={newPage} onChange={(e) => setNewPage(e.target.value)} placeholder="имя новой ФП" className={`${inp} max-w-[190px]`} />
                <button type="button" onClick={addPage} disabled={pending} className="rounded-full border border-line2 bg-sub px-3 py-1.5 text-[11.5px] text-soft transition hover:border-sage hover:text-sage">+ ФП</button>
              </div>
              {asset.pages.length === 0 ? <p className="mt-1 text-[11px] text-rust">Нет страниц под токеном — создай выше</p> : null}
            </div>
            <div>
              <div className="lab mb-1">Пиксель</div>
              <select value={pixelId} onChange={(e) => setPixelId(e.target.value)} className={inp}>
                <option value="">—</option>
                {asset.pixels.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <div className="mt-1.5 flex items-center gap-2">
                <input value={newPixel} onChange={(e) => setNewPixel(e.target.value)} placeholder="имя нового пикселя" className={`${inp} max-w-[190px]`} />
                <button type="button" onClick={addPixel} disabled={pending} className="rounded-full border border-line2 bg-sub px-3 py-1.5 text-[11.5px] text-soft transition hover:border-sage hover:text-sage">+ пиксель</button>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {/* Шаблон + ролик + тексты */}
      <div className={box}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-semibold">Шаблон и объявление</span>
          <TemplatePicker templates={templates} value={templateId} onPick={setTemplateId} />
          {tpl ? <span className="rounded-full border border-line bg-sub px-3 py-1 text-[11.5px] text-mute">{tpl.countries} · {tpl.event}</span> : null}
        </div>
        <div className="mt-3 grid gap-2">
          <input value={campaignName} onChange={(e) => setCampaignName(e.target.value)} placeholder="Название кампании" className={inp} />
          <div className="grid gap-2 sm:grid-cols-[1fr_140px]">
            <input value={link} onChange={(e) => setLink(e.target.value.replace(/\s+/g, ''))} type="url" placeholder="Ссылка на лендинг (https://…)" className={inp} />
            <input value={budget} onChange={(e) => setBudget(e.target.value)} inputMode="decimal" placeholder="$/день" className={inp} />
          </div>
          <div>
            <div className="lab mb-1">Ролик (видеофайл)</div>
            <input ref={fileRef} type="file" accept="video/*" onChange={(e) => setVideo(e.target.files?.[0] ?? null)} className="block w-full text-[12px] text-soft file:mr-3 file:rounded-full file:border file:border-line2 file:bg-sub file:px-4 file:py-1.5 file:text-[12px] file:text-soft hover:file:border-sage" />
            {video ? <p className="mt-1 text-[11px] text-sage">{video.name} · {(video.size / 1024 / 1024).toFixed(1)} МБ</p> : null}
          </div>
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Текст объявления" rows={3} className="w-full rounded-xl border border-line2 bg-sub px-3 py-2 text-[12.5px] text-soft outline-none focus:border-sage" />
          <div className="grid gap-2 sm:grid-cols-2">
            <input value={headline} onChange={(e) => setHeadline(e.target.value)} placeholder="Заголовок (опц.)" className={inp} />
            <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Описание (опц.)" className={inp} />
          </div>
          <div className="rounded-xl border border-amber/40 bg-amber-t/40 px-3 py-2">
            <div className="lab mb-1 text-amber">fb_pixel (метка в ссылке)</div>
            <input value={fbPixel} onChange={(e) => setFbPixel(e.target.value.replace(/\D/g, ''))} inputMode="numeric" placeholder="напр. 5645645435" className={`n ${inp}`} />
          </div>
        </div>
      </div>

      {/* Режим + запуск */}
      <div className="flex flex-wrap items-center gap-2">
        {(['paused', 'active', 'midnight'] as const).map((m) => (
          <button key={m} type="button" onClick={() => setMode(m)} className={`rounded-full border px-3.5 py-1.5 text-[12px] transition ${mode === m ? 'border-sage bg-sage-t text-sage' : 'border-line2 bg-sub text-soft hover:border-sage'}`}>
            {m === 'paused' ? 'На паузе' : m === 'active' ? 'Сразу в актив' : 'С 00:00 МСК'}
          </button>
        ))}
        <button type="button" onClick={fire} disabled={pending} className={`ml-auto rounded-full border border-sage bg-sage-t px-6 py-2.5 text-[13px] font-semibold text-sage transition ${pending ? 'opacity-50' : 'hover:brightness-110'}`}>
          {pending ? 'Заливаю…' : 'Залить видео'}
        </button>
      </div>
      {msg ? <div className="text-[12px] text-mute">{msg}</div> : null}

      {result ? (
        <div className={`rounded-[12px] border bg-sub px-3.5 py-2.5 ${result.ok ? (result.phoneRequired ? 'border-amber/40' : 'border-line') : 'border-rust/40'}`}>
          <div className="flex items-center gap-2 text-[12.5px]">
            <span className={result.ok ? (result.phoneRequired ? 'text-amber' : 'text-sage') : 'text-rust'}>{result.ok ? (result.phoneRequired ? '⚠' : '✓') : '✗'}</span>
            <span className="min-w-0 flex-1 truncate text-soft">{result.label}</span>
            <span className="shrink-0 text-[11.5px] text-mute">{result.ok ? (result.phoneRequired ? 'создано, но на паузе (нужен телефон)' : `${result.adsCreated} объявл.`) : (result.error ?? 'ошибка')}</span>
            {result.log?.length ? <button type="button" onClick={() => setOpenLog((v) => !v)} className="shrink-0 text-[11px] text-mute transition hover:text-sage">{openLog ? 'скрыть' : 'журнал'}</button> : null}
          </div>
          {openLog && result.log?.length ? <pre className="scroll-slim mt-2 max-h-[240px] overflow-auto whitespace-pre-wrap text-[11px] leading-relaxed text-dim">{result.log.join('\n')}</pre> : null}
        </div>
      ) : null}
    </div>
  );
}
