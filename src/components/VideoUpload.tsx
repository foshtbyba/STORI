'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { loadCabinetAssets, makePixel, makePage, startUpload } from '@/app/actions/autoupload';
import TemplatePicker from './TemplatePicker';
import JobsJournal from './JobsJournal';
import type { Template } from './TemplateManager';
import type { Language } from './LanguagePack';
import ComboSelect from './ComboSelect';
import { LOCALES, localeName } from '@/lib/locales';

type Cabinet = { id: string; name: string; externalId: string; currency: string; group: string };
type Asset = { pages: { id: string; name: string }[]; pixels: { id: string; name: string }[] };
type Mode = 'paused' | 'active' | 'midnight' | 'scheduled';

type VideoDraft = {
  id: string;
  cabId: string; cabLabel: string;
  pageId: string; pixelId: string;
  templateId: string; tplName: string;
  campaignName: string; link: string; budget: string;
  message: string; headline: string; description: string;
  fbPixel: string; mode: Mode; startLocal: string;
  withLanguages: boolean; mainLocale: string;
  video: File | null;
};

const uid = () => Math.random().toString(36).slice(2, 9);

const inp = 'h-9 w-full rounded-xl border border-line2 bg-sub px-3 text-[12.5px] text-soft outline-none focus:border-sage';
const box = 'rounded-[16px] border border-line bg-panel/40 px-4 py-4 sm:px-5';
const DEFAULT_TAGS_VIDEO = 'ad_id={{ad.id}}&fbpx={{pixel}}&fb_pixel={{fbpixel}}&account_id={{account.id}}&campaign_id={{campaign.id}}';

function nextMoscowMidnight(): string {
  const now = new Date();
  const msk = new Date(now.getTime() + 3 * 3600_000);
  return new Date(Date.UTC(msk.getUTCFullYear(), msk.getUTCMonth(), msk.getUTCDate() + 1, 0, 0, 0) - 3 * 3600_000).toISOString();
}

/**
 * Видео-залив: основной ролик (+ языки из пака в одно объявление) на выбранные
 * кабинеты. Выбор кабинетов — как в статичном заливе: овнер (SKO/MPR), список с
 * поиском по имени/ID и мультивыбором, ФП и пиксель по каждому кабинету. По
 * умолчанию всё НА ПАУЗЕ. В очередь кладём по одному заливу на кабинет.
 */
export default function VideoUpload({ cabinets, templates, languages = [] }: { cabinets: Cabinet[]; templates: Template[]; languages?: Language[] }) {
  const [pending, start] = useTransition();

  // SKO первым, остальные по алфавиту — как в основном заливе.
  const owners = useMemo(() => {
    const uniq = [...new Set(cabinets.map((c) => c.group))];
    return uniq.sort((a, b) => (a === 'SKO' ? -1 : b === 'SKO' ? 1 : a.localeCompare(b)));
  }, [cabinets]);
  const byId = useMemo(() => new Map(cabinets.map((c) => [c.id, c])), [cabinets]);

  const [owner, setOwner] = useState(owners[0] ?? '');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [qCab, setQCab] = useState('');
  const [assets, setAssets] = useState<Record<string, Asset>>({});
  const [pageByAcc, setPageByAcc] = useState<Record<string, string>>({});
  const [pixelByAcc, setPixelByAcc] = useState<Record<string, string>>({});
  const [newPixelByAcc, setNewPixelByAcc] = useState<Record<string, string>>({});
  const [newPageByAcc, setNewPageByAcc] = useState<Record<string, string>>({});
  const [assetMsg, setAssetMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [templateId, setTemplateId] = useState('');
  const [campaignName, setCampaignName] = useState('');
  const [link, setLink] = useState('');
  const [budget, setBudget] = useState('');
  const [message, setMessage] = useState('');
  const [headline, setHeadline] = useState('');
  const [description, setDescription] = useState('');
  const [fbPixel, setFbPixel] = useState('');
  const [mode, setMode] = useState<Mode>('paused');
  const [startLocal, setStartLocal] = useState('');
  const [withLanguages, setWithLanguages] = useState(languages.length > 0);
  const [mainLocale, setMainLocale] = useState('');
  const [video, setVideo] = useState<File | null>(null);
  const [msg, setMsg] = useState('');
  const [journalKey, setJournalKey] = useState(0);
  const [queue, setQueue] = useState<VideoDraft[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  // Последнее авто-имя (гео-префикс) — чтобы подменять при смене шаблона, но не
  // затирать введённое руками.
  const autoName = useRef('');

  // Память выбора овнера/кабинетов (свои ключи, чтобы не путать со статикой).
  useEffect(() => {
    try {
      const o = localStorage.getItem('videoupload:owner');
      if (o && owners.includes(o)) setOwner(o);
      const s = localStorage.getItem('videoupload:selected');
      if (s) {
        const ids = JSON.parse(s) as string[];
        if (Array.isArray(ids)) setSelected(new Set(ids.filter((id) => byId.has(id))));
      }
    } catch { /* приватный режим — просто без памяти */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { try { localStorage.setItem('videoupload:owner', owner); } catch { /* игнор */ } }, [owner]);
  useEffect(() => { try { localStorage.setItem('videoupload:selected', JSON.stringify([...selected])); } catch { /* игнор */ } }, [selected]);

  const tpl = templates.find((t) => t.id === templateId) ?? null;
  const ownerCabs = cabinets.filter((c) => c.group === owner);
  const selectedList = ownerCabs.filter((c) => selected.has(c.id));
  const cabNeedle = qCab.trim().toLowerCase();
  const visibleCabs = cabNeedle
    ? ownerCabs.filter((c) => c.name.toLowerCase().includes(cabNeedle) || c.externalId.toLowerCase().includes(cabNeedle))
    : ownerCabs;
  const anyAssets = selectedList.some((c) => assets[c.id]);

  const switchOwner = (o: string) => {
    if (o === owner) return;
    setOwner(o);
    setSelected(new Set());
    setQCab('');
  };

  const toggle = (id: string) =>
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = (on: boolean) =>
    setSelected((prev) => {
      const n = new Set(prev);
      for (const c of visibleCabs) { if (on) n.add(c.id); else n.delete(c.id); }
      return n;
    });

  const loadAssets = () => {
    if (pending || selectedList.length === 0) return;
    setMsg('');
    setAssetMsg(null);
    start(async () => {
      const targets = selectedList.filter((c) => !assets[c.id]);
      const list = targets.length ? targets : selectedList;
      const got = await Promise.all(list.map(async (c) => [c.id, await loadCabinetAssets(c.id)] as const));
      const nA = { ...assets }, nP = { ...pageByAcc }, nX = { ...pixelByAcc };
      const fails: string[] = [];
      let okCount = 0;
      for (const [id, r] of got) {
        if (!r.ok) { fails.push(`${byId.get(id)?.name || id} — ${r.error || 'нет доступа'}`); continue; }
        okCount += 1;
        nA[id] = { pages: r.pages ?? [], pixels: r.pixels ?? [] };
        if ((r.pages?.length ?? 0) === 1) nP[id] = r.pages![0].id;
        if ((r.pixels?.length ?? 0) === 1) nX[id] = r.pixels![0].id;
      }
      setAssets(nA); setPageByAcc(nP); setPixelByAcc(nX);
      if (fails.length) setAssetMsg({ ok: false, text: `Не подтянулось: ${fails.join(' · ')}` });
      else if (okCount) setAssetMsg({ ok: true, text: 'ФП и пиксели подтянуты.' });
    });
  };

  const addPixel = (accId: string) => {
    if (pending) return;
    start(async () => {
      const r = await makePixel(accId, newPixelByAcc[accId] ?? '');
      if (!r.ok) { setMsg(r.error ?? 'сбой создания пикселя'); return; }
      setAssets((a) => ({ ...a, [accId]: { pages: a[accId]?.pages ?? [], pixels: r.pixels ?? [] } }));
      if (r.pixels?.length) setPixelByAcc((p) => ({ ...p, [accId]: r.pixels![r.pixels!.length - 1].id }));
      setNewPixelByAcc((n) => ({ ...n, [accId]: '' }));
    });
  };

  const addPage = (accId: string) => {
    if (pending) return;
    const name = (newPageByAcc[accId] ?? '').trim();
    if (!name) { setMsg('Впиши имя новой страницы'); return; }
    start(async () => {
      const r = await makePage(accId, name);
      if (!r.ok) { setMsg(r.error ?? 'сбой создания страницы'); return; }
      setAssets((a) => ({ ...a, [accId]: { pages: r.pages ?? [], pixels: a[accId]?.pixels ?? [] } }));
      if (r.pages?.length) setPageByAcc((p) => ({ ...p, [accId]: r.pages![r.pages!.length - 1].id }));
      setNewPageByAcc((n) => ({ ...n, [accId]: '' }));
    });
  };

  const onPickTemplate = (id: string) => {
    setTemplateId(id);
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    if (!budget.trim()) setBudget((t.dailyBudgetCents / 100).toString());
    const geo = t.countries.split(',').map((s) => s.trim()).filter(Boolean).join(' ');
    if (geo && (campaignName.trim() === '' || campaignName === autoName.current)) {
      const v = `${geo} `;
      setCampaignName(v);
      autoName.current = v;
    }
  };

  // В режиме языков с непустым паком (есть языки с видео) основной ролик
  // необязателен: дефолтным станет язык из пака.
  const langsWithVideo = languages.filter((l) => l.hasVideo || l.videoUrl).length;
  const mainOptional = withLanguages && langsWithVideo > 0;

  const validate = (): string | null => {
    if (selectedList.length === 0) return 'Выбери хотя бы один кабинет';
    if (!templateId) return 'Выбери шаблон гео';
    if (!video && !mainOptional) return 'Добавь ролик (видеофайл) или включи языки с видео';
    if (!/^https?:\/\//i.test(link.trim())) return 'Ссылка должна начинаться с http(s)://';
    if (!message.trim()) return 'Текст объявления пустой';
    if (!fbPixel.trim()) return 'Впиши номер fb_pixel';
    for (const c of selectedList) {
      if (!assets[c.id]) return `Подтяни ФП/пиксели: ${c.name || c.externalId}`;
      if (!pageByAcc[c.id]) return `Выбери страницу: ${c.name || c.externalId}`;
      if (!pixelByAcc[c.id]) return `Выбери/создай пиксель: ${c.name || c.externalId}`;
    }
    if (mode === 'scheduled') {
      const d = startLocal ? new Date(startLocal) : null;
      if (!d || Number.isNaN(d.getTime())) return 'Укажи дату и время планового старта';
      if (d.getTime() < Date.now() + 60_000) return 'Время старта должно быть в будущем';
    }
    return null;
  };

  // По одному заливу на кабинет (у каждого свои ФП/пиксель). Один ролик — общий.
  const addToQueue = () => {
    setMsg('');
    const err = validate();
    if (err) { setMsg(err); return; }
    const drafts: VideoDraft[] = selectedList.map((c) => ({
      id: uid(),
      cabId: c.id, cabLabel: c.name || c.externalId,
      pageId: pageByAcc[c.id], pixelId: pixelByAcc[c.id],
      templateId, tplName: tpl?.name ?? '',
      campaignName: campaignName.trim(), link: link.trim(), budget: budget.trim(),
      message: message.trim(), headline: headline.trim(), description: description.trim(),
      fbPixel: fbPixel.trim(), mode, startLocal,
      withLanguages, mainLocale,
      video,
    }));
    setQueue((q) => [...q, ...drafts]);
    setVideo(null);
    if (fileRef.current) fileRef.current.value = '';
    setCampaignName(''); setLink(''); setMessage(''); setHeadline(''); setDescription('');
    autoName.current = '';
    setMsg(`Добавлено в очередь: ${drafts.length} (по кабинетам). Собери ещё или жми «Залить всё».`);
  };

  const fireAll = () => {
    setMsg('');
    if (queue.length === 0) { setMsg('Очередь пуста — собери хотя бы один залив'); return; }
    start(async () => {
      for (const d of queue) {
        const fd = new FormData();
        fd.set('accountId', d.cabId);
        fd.set('templateId', d.templateId);
        fd.set('pageId', d.pageId);
        fd.set('pixelId', d.pixelId);
        fd.set('campaignName', d.campaignName);
        fd.set('link', d.link);
        fd.set('budget', d.budget);
        fd.set('message', d.message);
        fd.set('headline', d.headline);
        fd.set('description', d.description);
        fd.set('urlTags', DEFAULT_TAGS_VIDEO);
        fd.set('manualPixel', d.fbPixel);
        fd.set('mode', d.mode);
        if (d.withLanguages) fd.set('withLanguages', '1');
        if (d.mainLocale) fd.set('mainLocale', d.mainLocale);
        if (d.mode === 'midnight') fd.set('startAt', nextMoscowMidnight());
        if (d.mode === 'scheduled' && d.startLocal) fd.set('startAt', new Date(d.startLocal).toISOString());
        if (d.video) fd.set('video', d.video);
        await startUpload(fd);
      }
      const n = queue.length;
      setQueue([]);
      setMsg(`🚀 Запущено в фоне: ${n}. Результат — в «Журнале заливов» ниже (один кабинет по очереди, разные — параллельно). Можно уйти со страницы.`);
      setJournalKey((k) => k + 1);
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-[12px] border border-amber/40 bg-amber-t/30 px-3.5 py-2.5 text-[11.5px] text-amber">
        Видео-метод: основной ролик (+ языки из пака в одно объявление) на выбранные кабинеты. По умолчанию заливается <b>на паузе</b> — проверь в Ads Manager.
      </div>

      {/* 1 · Овнер + кабинеты (как в статичном заливе) */}
      <div className={box}>
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="text-[13px] font-semibold">На кого заливаем</span>
          <div className="flex flex-wrap items-center gap-1.5">
            {owners.map((o) => (
              <button key={o} type="button" onClick={() => switchOwner(o)} className={`rounded-full border px-3.5 py-1 text-[12px] transition ${o === owner ? 'border-amber bg-amber-t text-amber' : 'border-line2 bg-sub text-soft hover:border-amber'}`}>
                {o}
              </button>
            ))}
          </div>
          <span className="ml-auto text-[12px] text-mute">выбрано {selectedList.length} из {ownerCabs.length}</span>
        </div>

        <div className="scroll-slim mt-3 max-h-[240px] overflow-auto rounded-[12px] border border-line">
          <div className="sticky top-0 z-10 flex items-center gap-2 bg-sub px-3 py-1.5">
            <span className="shrink-0 text-[11.5px] font-semibold text-amber">{owner} · кабинеты</span>
            <input
              value={qCab}
              onChange={(e) => setQCab(e.target.value)}
              placeholder="Поиск по имени или ID…"
              className="ml-auto h-7 w-[46%] min-w-[140px] rounded-lg border border-line2 bg-bg px-2.5 text-[11.5px] text-soft placeholder:text-dim"
            />
            <button type="button" onClick={() => toggleAll(!(visibleCabs.length > 0 && visibleCabs.every((c) => selected.has(c.id))))} className="shrink-0 text-[11px] text-mute transition hover:text-sage">
              {visibleCabs.length > 0 && visibleCabs.every((c) => selected.has(c.id)) ? 'снять все' : 'выбрать все'}
            </button>
          </div>
          {visibleCabs.map((c) => (
            <label key={c.id} className="flex cursor-pointer items-center gap-2.5 border-t border-line px-3 py-1.5 text-[12.5px] transition hover:bg-sub/60">
              <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} className="accent-[#b4c68c]" />
              <span className="min-w-0 flex-1 truncate text-soft">{c.name || c.externalId}</span>
              {c.name && c.name !== c.externalId ? (
                <span className="n shrink-0 text-[11px] text-dim">{c.externalId}</span>
              ) : null}
              <span className="shrink-0 text-[11px] text-dim">{c.currency}</span>
            </label>
          ))}
          {ownerCabs.length === 0 ? (
            <div className="px-3 py-3 text-[12px] text-mute">У этого овнера нет кабинетов.</div>
          ) : visibleCabs.length === 0 ? (
            <div className="px-3 py-3 text-[12px] text-mute">Ничего не найдено по «{qCab.trim()}».</div>
          ) : null}
        </div>

        {selectedList.length > 0 ? (
          <button type="button" onClick={loadAssets} disabled={pending} className={`mt-3 rounded-full border border-line2 bg-sub px-4 py-1.5 text-[12px] text-soft transition hover:border-sage hover:text-sage ${pending ? 'cursor-progress opacity-60' : ''}`}>
            {pending ? 'Читаю кабинеты…' : selectedList.every((c) => assets[c.id]) ? 'Обновить ФП/пиксели' : `Подтянуть ФП и пиксели (${selectedList.length})`}
          </button>
        ) : null}
        {assetMsg ? (
          <div className="mt-2.5 rounded-[12px] border px-3 py-2 text-[12px]" style={assetMsg.ok ? { borderColor: '#3c4d33', background: '#1c241a', color: '#b4c68c' } : { borderColor: '#5a3a2a', background: '#2c1f1a', color: '#ce6e58' }}>
            {assetMsg.text}
          </div>
        ) : null}
      </div>

      {/* 2 · ФП + пиксель по кабинетам */}
      {anyAssets ? (
        <div className={box}>
          <span className="text-[13px] font-semibold">Страница и пиксель по кабинетам</span>
          <div className="mt-3 flex flex-col gap-2.5">
            {selectedList.map((c) => {
              const a = assets[c.id];
              if (!a) return <div key={c.id} className="rounded-[12px] border border-line px-3 py-2 text-[12px] text-mute">{c.name || c.externalId} — не подтянут.</div>;
              return (
                <div key={c.id} className="rounded-[12px] border border-line px-3 py-2.5">
                  <div className="text-[12px] font-medium text-soft">{c.name || c.externalId}</div>
                  {/* 4 колонки: выбрать ФП · создать ФП · выбрать пиксель · создать пиксель. */}
                  <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                    <select value={pageByAcc[c.id] ?? ''} onChange={(e) => setPageByAcc((p) => ({ ...p, [c.id]: e.target.value }))} className={inp}>
                      <option value="">— страница (ФП) —</option>
                      {a.pages.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                    <div className="flex items-center gap-2">
                      <input value={newPageByAcc[c.id] ?? ''} onChange={(e) => setNewPageByAcc((n) => ({ ...n, [c.id]: e.target.value }))} placeholder="имя новой ФП" className={`${inp} min-w-0 flex-1`} />
                      <button type="button" onClick={() => addPage(c.id)} disabled={pending} className="shrink-0 rounded-full border border-line2 bg-sub px-3 py-1.5 text-[11.5px] text-soft transition hover:border-sage hover:text-sage">+ ФП</button>
                    </div>
                    <select value={pixelByAcc[c.id] ?? ''} onChange={(e) => setPixelByAcc((p) => ({ ...p, [c.id]: e.target.value }))} className={inp}>
                      <option value="">— пиксель —</option>
                      {a.pixels.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                    <div className="flex items-center gap-2">
                      <input value={newPixelByAcc[c.id] ?? ''} onChange={(e) => setNewPixelByAcc((n) => ({ ...n, [c.id]: e.target.value }))} placeholder="имя нового пикселя" className={`${inp} min-w-0 flex-1`} />
                      <button type="button" onClick={() => addPixel(c.id)} disabled={pending} className="shrink-0 rounded-full border border-line2 bg-sub px-3 py-1.5 text-[11.5px] text-soft transition hover:border-sage hover:text-sage">+ пиксель</button>
                    </div>
                  </div>
                  {a.pages.length === 0 ? <p className="mt-1.5 text-[11px] text-rust">нет страниц под токеном — создай ФП слева</p> : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* 3 · Шаблон + ролик + тексты */}
      <div className={box}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-semibold">Шаблон и объявление</span>
          <TemplatePicker templates={templates} value={templateId} onPick={onPickTemplate} />
          {tpl ? <span className="rounded-full border border-line bg-sub px-3 py-1 text-[11.5px] text-mute">{tpl.countries} · {tpl.event}</span> : null}
        </div>
        <div className="mt-3 grid gap-2">
          <input value={campaignName} onChange={(e) => setCampaignName(e.target.value)} placeholder="Название кампании" className={inp} />
          <div className="grid gap-2 sm:grid-cols-[1fr_140px]">
            <input value={link} onChange={(e) => setLink(e.target.value.replace(/\s+/g, ''))} type="url" placeholder="Ссылка на лендинг (https://…)" className={inp} />
            <input value={budget} onChange={(e) => setBudget(e.target.value)} inputMode="decimal" placeholder="$/день" className={inp} />
          </div>
          <div>
            <div className="lab mb-1">Ролик (видеофайл) {mainOptional ? <span className="text-dim">— необязателен: с языками дефолт возьмётся из пака</span> : null}</div>
            <input ref={fileRef} type="file" accept="video/*" onChange={(e) => setVideo(e.target.files?.[0] ?? null)} className="block w-fit max-w-full text-[12px] text-soft file:mr-3 file:rounded-full file:border file:border-line2 file:bg-sub file:px-4 file:py-1.5 file:text-[12px] file:text-soft hover:file:border-sage" />
            {video ? <p className="mt-1 text-[11px] text-sage">{video.name} · {(video.size / 1024 / 1024).toFixed(1)} МБ</p> : mainOptional ? <p className="mt-1 text-[11px] text-dim">Без файла соберём объявление из языков пака (дефолт — язык ниже).</p> : null}
          </div>
          <div>
            <div className="lab mb-1">Язык основного ролика <span className="text-dim">(нужен для языков — идёт в дефолтное правило)</span></div>
            <ComboSelect
              options={LOCALES.map((l) => ({ id: l.code, name: l.name }))}
              value={mainLocale}
              onChange={setMainLocale}
              placeholder="— язык основного —"
              searchPlaceholder="Найди язык…"
              className="w-[240px] max-w-full"
            />
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

      {/* Языки из пака */}
      <div className={box}>
        <label className="flex cursor-pointer items-center gap-2 text-[13px] font-semibold text-soft">
          <input type="checkbox" checked={withLanguages} onChange={(e) => setWithLanguages(e.target.checked)} disabled={languages.length === 0} className="accent-[#b4c68c]" />
          Добавить языки из пака <span className="text-mute">· {languages.length}</span>
        </label>
        {languages.length === 0 ? (
          <p className="mt-1.5 text-[11px] text-mute">Пак пуст — заполни языки во вкладке «Языки». Тогда они добавятся в одно видео-объявление (у каждого свой ролик и тексты).</p>
        ) : withLanguages ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {languages.map((l) => (
              <span key={l.id} className={`rounded-full border px-2.5 py-1 text-[11.5px] ${l.hasVideo || l.videoUrl ? 'border-line bg-sub text-soft' : 'border-rust/40 text-rust'}`}>
                {localeName(l.locale)}{l.hasVideo || l.videoUrl ? '' : ' · без видео'}
              </span>
            ))}
          </div>
        ) : (
          <p className="mt-1.5 text-[11px] text-mute">Выключено — зальётся только основной ролик.</p>
        )}
        {withLanguages && languages.length ? (
          <p className="mt-2 text-[11px] text-dim">Основной ролик — дефолт (по его языку), а эти языки FB покажет по языку пользователя. Языки без видео пропустятся.</p>
        ) : null}
      </div>

      {/* Режим + запуск */}
      <div className="flex flex-wrap items-center gap-2">
        {(['paused', 'active', 'midnight', 'scheduled'] as const).map((m) => (
          <button key={m} type="button" onClick={() => setMode(m)} className={`rounded-full border px-3.5 py-1.5 text-[12px] transition ${mode === m ? 'border-sage bg-sage-t text-sage' : 'border-line2 bg-sub text-soft hover:border-sage'}`}>
            {m === 'paused' ? 'На паузе' : m === 'active' ? 'Сразу в актив' : m === 'midnight' ? 'С 00:00 МСК' : 'По расписанию'}
          </button>
        ))}
        {mode === 'scheduled' ? (
          <input value={startLocal} onChange={(e) => setStartLocal(e.target.value)} type="datetime-local" className="h-9 w-[210px] rounded-xl border border-line2 bg-sub px-3 text-[12.5px] text-soft outline-none focus:border-sage" />
        ) : null}
        <button type="button" onClick={addToQueue} className="ml-auto rounded-full border border-sage bg-sage-t px-5 py-2 text-[12.5px] font-medium text-sage transition hover:brightness-110">
          + В очередь{selectedList.length > 1 ? ` (${selectedList.length})` : ''}
        </button>
      </div>
      {msg ? <div className="text-[12px] text-sage">{msg}</div> : null}

      {/* Очередь видео-заливов */}
      <div className="rounded-[16px] border border-line2 bg-panel/60 p-4 sm:p-5">
        <div className="flex items-center gap-2.5">
          <span className="text-[14px] font-semibold">Очередь видео</span>
          <span className="text-[12px] text-mute">{queue.length} заливов</span>
        </div>
        {queue.length === 0 ? (
          <p className="mt-3 text-[12px] text-mute">Пусто. Собери залив выше и добавь в очередь — можно подготовить несколько и запустить всё разом.</p>
        ) : (
          <div className="mt-3 flex flex-col gap-2">
            {queue.map((d) => (
              <div key={d.id} className="rounded-[12px] border border-line px-3.5 py-2.5">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-soft">{d.campaignName || 'без имени'} <span className="text-mute">· {d.cabLabel}</span></span>
                  <span className="shrink-0 text-[11px] text-mute">{d.mode === 'paused' ? 'на паузе' : d.mode === 'active' ? 'в актив' : d.mode === 'midnight' ? 'с 00:00' : 'по расписанию'}</span>
                  <button type="button" onClick={() => setQueue((q) => q.filter((x) => x.id !== d.id))} className="shrink-0 rounded-full border border-line2 px-2.5 py-1 text-[11px] text-mute transition hover:border-rust hover:text-rust">убрать</button>
                </div>
                <div className="mt-1.5 text-[11px] text-dim">{d.tplName || 'шаблон?'} · 🎬 {d.video ? `${d.video.name} · ${(d.video.size / 1024 / 1024).toFixed(1)} МБ` : 'ролики из пака языков'}{d.withLanguages ? ` · +языки` : ''}{d.budget ? ` · $${d.budget}/д` : ''}</div>
              </div>
            ))}
          </div>
        )}
        <button type="button" onClick={fireAll} disabled={pending || queue.length === 0} className={`mt-3 rounded-full border border-sage bg-sage-t px-6 py-2.5 text-[13px] font-semibold text-sage transition ${pending || queue.length === 0 ? 'opacity-50' : 'hover:brightness-110'}`}>
          {pending ? 'Запускаю…' : `Залить всё${queue.length ? ` (${queue.length})` : ''}`}
        </button>
      </div>

      <JobsJournal key={journalKey} />
    </div>
  );
}
