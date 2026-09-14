'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { loadCabinetAssets, makePixel, makePage, runAutoupload, type UploadResult } from '@/app/actions/autoupload';
import type { Template } from './TemplateManager';
import type { Language } from './LanguagePack';
import { placementSummary } from '@/lib/placements';
import { localeName } from '@/lib/locales';

type Cabinet = { id: string; name: string; externalId: string; currency: string; group: string };
type Asset = { pages: { id: string; name: string }[]; pixels: { id: string; name: string }[] };
type Mode = 'paused' | 'active' | 'scheduled';
type Pick = { pageId: string; pixelId: string };

/** Готовый залив в очереди. Один овнер, свои кабинеты (у каждого своя ФП+пиксель),
 *  общий креатив и картинки. Картинки держим прямо в объекте (File живёт в памяти). */
type Draft = {
  id: string;
  owner: string;
  cabinetIds: string[];
  pick: Record<string, Pick>;
  templateId: string;
  campaignName: string;
  link: string;
  budget: string;
  message: string;
  headline: string;
  description: string;
  urlTags: string;
  manualPixel: string;
  mode: Mode;
  startAt: string; // ISO или ''
  startLocal: string; // для префилла при правке
  files: File[];
};

const inp = 'h-9 w-full rounded-xl border border-line2 bg-sub px-3 text-[12.5px] text-soft outline-none focus:border-sage';
const box = 'rounded-[16px] border border-line bg-panel/40 px-4 py-4 sm:px-5';
const stepBadge = 'flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sage-t text-[12px] font-semibold text-sage';
const DEFAULT_TAGS = 'ad_id={{ad.id}}&fbpx={{pixel}}&fb_pixel={{fbpixel}}&account_id={{account.id}}&campaign_id={{campaign.id}}';
const uid = () => Math.random().toString(36).slice(2, 9);

const modeLabel = (m: Mode) => (m === 'active' ? 'в актив' : m === 'scheduled' ? 'по расписанию' : 'на паузе');

/**
 * Человеческая причина, почему кабинет не подтянулся. Ошибки токена/сессии
 * (протух, отозван, «сессия кончилась», код 190/1/100) сводим к «токен слетел».
 */
function friendlyReason(err?: string): string {
  const e = (err ?? '').toLowerCase();
  if (!e) return 'токен слетел (обнови токен кабинета)';
  if (
    e.includes('токен') || e.includes('сесси') || e.includes('код 190') || e.includes('(#190') ||
    e.includes('code 190') || e.includes('код 1)') || e.includes('код 1/') || e.includes('код 100') ||
    e.includes('invalid') || e.includes('expired') || e.includes('oauth')
  ) {
    return 'токен слетел — обнови токен кабинета';
  }
  return err ?? '';
}

/**
 * Автозалив. Сверху выбираешь овнера (SKO/MPR) — показываются только его
 * кабинеты. Конструктор собирает ОДИН залив и кладёт его в очередь; так можно
 * подготовить хоть десять разных заливов и запустить всё одной кнопкой.
 * Заливаем по кабинетам по очереди, чтобы не ловить троттлинг Меты.
 */
export default function AutouploadForm({ cabinets, templates, languages = [] }: { cabinets: Cabinet[]; templates: Template[]; languages?: Language[] }) {
  const [pending, start] = useTransition();

  // Овнеров сортируем так, чтобы SKO был первым, остальные по алфавиту.
  const owners = useMemo(() => {
    const uniq = [...new Set(cabinets.map((c) => c.group))];
    return uniq.sort((a, b) => (a === 'SKO' ? -1 : b === 'SKO' ? 1 : a.localeCompare(b)));
  }, [cabinets]);
  const byId = useMemo(() => new Map(cabinets.map((c) => [c.id, c])), [cabinets]);

  // ── Конструктор одного залива ──
  const [owner, setOwner] = useState(owners[0] ?? '');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [assets, setAssets] = useState<Record<string, Asset>>({});
  const [pageByAcc, setPageByAcc] = useState<Record<string, string>>({});
  const [pixelByAcc, setPixelByAcc] = useState<Record<string, string>>({});
  const [newPixelByAcc, setNewPixelByAcc] = useState<Record<string, string>>({});
  const [newPageByAcc, setNewPageByAcc] = useState<Record<string, string>>({});
  const [templateId, setTemplateId] = useState('');
  const [campaignName, setCampaignName] = useState('');
  const [link, setLink] = useState('');
  const [budget, setBudget] = useState('');
  const [message, setMessage] = useState('');
  const [headline, setHeadline] = useState('');
  const [description, setDescription] = useState('');
  const [urlTags, setUrlTags] = useState(DEFAULT_TAGS);
  // fb_pixel вводится вручную каждый залив (из другого места) — не запоминаем.
  const [manualPixel, setManualPixel] = useState('');
  const [mode, setMode] = useState<Mode>('paused');
  const [startLocal, setStartLocal] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  // Последнее авто-имя (префикс гео) — чтобы подменять его при смене шаблона, но
  // не затирать то, что человек уже вписал руками.
  const autoName = useRef('');

  // ── Очередь и запуск ──
  const [queue, setQueue] = useState<Draft[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // Сообщение прямо под кнопкой «Подтянуть» — чтобы сбой был заметен сразу.
  const [assetMsg, setAssetMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [results, setResults] = useState<Record<string, UploadResult & { label: string }>>({});
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [confirm, setConfirm] = useState(false);
  // Метод залива. Сейчас сторис/статика; видео с языками — отдельным методом позже.
  const [method, setMethod] = useState<'static' | 'video'>('static');
  const tab = (on: boolean) =>
    `rounded-full border px-4 py-1.5 text-[12px] transition ${on ? 'border-sage bg-sage-t text-sage' : 'border-line2 bg-sub text-mute hover:border-sage'}`;

  // Запоминаем выбор овнера и кабинетов в браузере (localStorage), чтобы при
  // возврате не выбирать заново. Читаем один раз после монтирования.
  useEffect(() => {
    try {
      const o = localStorage.getItem('autoupload:owner');
      if (o && owners.includes(o)) setOwner(o);
      const s = localStorage.getItem('autoupload:selected');
      if (s) {
        const ids = JSON.parse(s) as string[];
        if (Array.isArray(ids)) setSelected(new Set(ids.filter((id) => byId.has(id))));
      }
    } catch { /* приватный режим / заблокированное хранилище — просто без памяти */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    try { localStorage.setItem('autoupload:owner', owner); } catch { /* игнор */ }
  }, [owner]);
  useEffect(() => {
    try { localStorage.setItem('autoupload:selected', JSON.stringify([...selected])); } catch { /* игнор */ }
  }, [selected]);

  const tpl = templates.find((t) => t.id === templateId) ?? null;
  const ownerCabs = cabinets.filter((c) => c.group === owner);
  const selectedList = ownerCabs.filter((c) => selected.has(c.id));

  const switchOwner = (o: string) => {
    if (o === owner) return;
    setOwner(o);
    setSelected(new Set());
  };

  const toggle = (id: string) =>
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = (on: boolean) =>
    setSelected(() => (on ? new Set(ownerCabs.map((c) => c.id)) : new Set()));

  const loadAssets = () => {
    if (pending || selectedList.length === 0) return;
    setMsg(null);
    setAssetMsg(null);
    start(async () => {
      const targets = selectedList.filter((c) => !assets[c.id]);
      const list = targets.length ? targets : selectedList;
      const got = await Promise.all(list.map(async (c) => [c.id, await loadCabinetAssets(c.id)] as const));
      const nA = { ...assets }, nP = { ...pageByAcc }, nX = { ...pixelByAcc };
      const fails: string[] = [];
      let okCount = 0;
      for (const [id, r] of got) {
        if (!r.ok) { fails.push(`${byId.get(id)?.name || id} — ${friendlyReason(r.error)}`); continue; }
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
      if (!r.ok) { setMsg({ ok: false, text: r.error ?? 'сбой создания пикселя' }); return; }
      setAssets((a) => ({ ...a, [accId]: { pages: a[accId]?.pages ?? [], pixels: r.pixels ?? [] } }));
      if (r.pixels?.length) setPixelByAcc((p) => ({ ...p, [accId]: r.pixels![r.pixels!.length - 1].id }));
      setNewPixelByAcc((n) => ({ ...n, [accId]: '' }));
      setMsg({ ok: true, text: 'Пиксель создан.' });
    });
  };

  const addPage = (accId: string) => {
    if (pending) return;
    const name = (newPageByAcc[accId] ?? '').trim();
    if (!name) { setMsg({ ok: false, text: 'Впиши имя новой страницы' }); return; }
    start(async () => {
      const r = await makePage(accId, name);
      if (!r.ok) { setMsg({ ok: false, text: r.error ?? 'сбой создания страницы' }); return; }
      setAssets((a) => ({ ...a, [accId]: { pages: r.pages ?? [], pixels: a[accId]?.pixels ?? [] } }));
      if (r.pages?.length) setPageByAcc((p) => ({ ...p, [accId]: r.pages![r.pages!.length - 1].id }));
      setNewPageByAcc((n) => ({ ...n, [accId]: '' }));
      setMsg({ ok: true, text: 'Страница создана.' });
    });
  };

  const onPickTemplate = (id: string) => {
    setTemplateId(id);
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    if (!budget) setBudget((t.dailyBudgetCents / 100).toString());
    // Название стартует с гео (напр. «RO »), дальше человек дописывает сам.
    // Подменяем только пустое поле или прошлый авто-префикс, руками введённое не трогаем.
    const geo = t.countries.split(',').map((s) => s.trim()).filter(Boolean).join(' ');
    if (geo && (campaignName.trim() === '' || campaignName === autoName.current)) {
      const v = `${geo} `;
      setCampaignName(v);
      autoName.current = v;
    }
  };

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    setFiles((prev) => {
      const key = (f: File) => `${f.name}:${f.size}`;
      const have = new Set(prev.map(key));
      const add = Array.from(list).filter((f) => !have.has(key(f)));
      return [...prev, ...add].slice(0, 20);
    });
    if (fileInput.current) fileInput.current.value = '';
  };

  const resetConstructor = () => {
    setSelected(new Set());
    setTemplateId(''); setCampaignName(''); setLink(''); setBudget('');
    setMessage(''); setHeadline(''); setDescription(''); setUrlTags(DEFAULT_TAGS);
    setMode('paused'); setStartLocal(''); setFiles([]); setEditingId(null);
    autoName.current = '';
  };

  const validateConstructor = (): string | null => {
    if (selectedList.length === 0) return 'Выбери хотя бы один кабинет';
    if (!templateId) return 'Выбери шаблон гео';
    if (!/^https?:\/\//i.test(link.trim())) return 'Ссылка на лендинг должна начинаться с http(s)://';
    if (!message.trim()) return 'Текст объявления пустой';
    if (files.length === 0) return 'Добавь хотя бы одну картинку';
    for (const c of selectedList) {
      if (!assets[c.id]) return `Подтяни ФП/пиксели: ${c.name || c.externalId}`;
      if (!pageByAcc[c.id]) return `Выбери страницу: ${c.name || c.externalId}`;
      if (!pixelByAcc[c.id]) return `Выбери/создай пиксель: ${c.name || c.externalId}`;
    }
    if ((urlTags.includes('{{fbpixel}}') || urlTags.includes('{{fb_pixel}}')) && !manualPixel.trim()) {
      return 'Впиши номер fb_pixel (метка fb_pixel в ссылке)';
    }
    if (mode === 'scheduled') {
      const d = startLocal ? new Date(startLocal) : null;
      if (!d || Number.isNaN(d.getTime())) return 'Укажи дату и время планового старта';
      if (d.getTime() < Date.now() + 60_000) return 'Время старта должно быть в будущем';
    }
    return null;
  };

  const addToQueue = () => {
    const err = validateConstructor();
    if (err) { setMsg({ ok: false, text: err }); return; }
    const pick: Record<string, Pick> = {};
    for (const c of selectedList) pick[c.id] = { pageId: pageByAcc[c.id], pixelId: pixelByAcc[c.id] };
    const startAt = mode === 'scheduled' && startLocal ? new Date(startLocal).toISOString() : '';
    const draft: Draft = {
      id: editingId ?? uid(),
      owner, cabinetIds: selectedList.map((c) => c.id), pick,
      templateId, campaignName: campaignName.trim(), link: link.trim(), budget: budget.trim(),
      message: message.trim(), headline: headline.trim(), description: description.trim(),
      urlTags: urlTags.trim(), manualPixel: manualPixel.trim(), mode, startAt, startLocal, files,
    };
    setQueue((q) => (editingId ? q.map((d) => (d.id === editingId ? draft : d)) : [...q, draft]));
    setMsg({ ok: true, text: editingId ? 'Черновик обновлён.' : 'Залив добавлен в очередь. Ссылку/текст/заголовок очистил — вставляй новые.' });
    setEditingId(null);
    // Кабинеты, ФП/пиксель, шаблон, бюджет, описание, метки, картинки, режим —
    // ОСТАВЛЯЕМ (быстро добавить следующий). Чистим только то, что каждый раз
    // новое: ссылку, текст и заголовок.
    setLink('');
    setMessage('');
    setHeadline('');
  };

  // Загрузить черновик обратно в конструктор для правки.
  const editDraft = (d: Draft) => {
    setOwner(d.owner);
    setSelected(new Set(d.cabinetIds));
    setPageByAcc((p) => ({ ...p, ...Object.fromEntries(d.cabinetIds.map((id) => [id, d.pick[id]?.pageId ?? ''])) }));
    setPixelByAcc((p) => ({ ...p, ...Object.fromEntries(d.cabinetIds.map((id) => [id, d.pick[id]?.pixelId ?? ''])) }));
    setTemplateId(d.templateId); setCampaignName(d.campaignName); setLink(d.link); setBudget(d.budget);
    setMessage(d.message); setHeadline(d.headline); setDescription(d.description); setUrlTags(d.urlTags); setManualPixel(d.manualPixel ?? '');
    setMode(d.mode); setStartLocal(d.startLocal); setFiles(d.files); setEditingId(d.id);
    autoName.current = ''; // имя из черновика — руками, авто-подмена его не трогает
    setMsg(null);
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const removeDraft = (id: string) =>
    setQueue((q) => q.filter((d) => d.id !== id));

  const totalTargets = queue.reduce((n, d) => n + d.cabinetIds.length, 0);
  const hasLive = queue.some((d) => d.mode !== 'paused');

  const fireAll = () => {
    if (pending || queue.length === 0) return;
    setMsg(null); setResults({}); setConfirm(false);
    start(async () => {
      setProgress({ done: 0, total: totalTargets });
      let ok = 0, done = 0;
      for (const d of queue) {
        for (const cabId of d.cabinetIds) {
          const cab = byId.get(cabId);
          const p = d.pick[cabId];
          const fd = new FormData();
          fd.set('accountId', cabId);
          fd.set('templateId', d.templateId);
          fd.set('pageId', p.pageId);
          fd.set('pixelId', p.pixelId);
          fd.set('campaignName', d.campaignName);
          fd.set('link', d.link);
          fd.set('budget', d.budget);
          fd.set('message', d.message);
          fd.set('headline', d.headline);
          fd.set('description', d.description);
          fd.set('urlTags', d.urlTags);
          fd.set('manualPixel', d.manualPixel ?? '');
          fd.set('mode', d.mode);
          if (d.startAt) fd.set('startAt', d.startAt);
          for (const f of d.files) fd.append('images', f);
          const r = await runAutoupload(fd);
          if (r.ok) ok += 1;
          done += 1;
          const label = `${cab?.name || cabId} · ${d.campaignName || 'без имени'}`;
          setResults((prev) => ({ ...prev, [`${d.id}:${cabId}`]: { ...r, label } }));
          setProgress({ done, total: totalTargets });
        }
      }
      setProgress(null);
      setMsg({ ok: ok === totalTargets, text: `Залито: ${ok}/${totalTargets} кабинетов.` });
    });
  };

  const onFireClick = () => {
    if (queue.length === 0) { setMsg({ ok: false, text: 'Очередь пуста — добавь хотя бы один залив' }); return; }
    if (!hasLive) { fireAll(); return; }
    if (!confirm) { setConfirm(true); return; }
    fireAll();
  };

  const [openLog, setOpenLog] = useState('');
  const anyAssets = selectedList.some((c) => assets[c.id]);

  return (
    <div className="flex flex-col gap-4">
      {/* Метод залива: сейчас сторис/статика; видео с языками — позже. */}
      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" onClick={() => setMethod('static')} className={tab(method === 'static')}>Сторис / статика</button>
        <button type="button" onClick={() => setMethod('video')} className={tab(method === 'video')}>Видео + языки</button>
      </div>

      {method === 'video' ? (
        <div className="rounded-[16px] border border-line bg-panel/40 px-4 py-6 text-[12.5px] text-mute">
          <div className="text-[13px] font-semibold text-soft">Видео + языки — на подключении</div>
          <p className="mt-2 leading-relaxed">
            Основной ролик грузишь файлом под гео-язык, а фиксированные доп. языки берутся из твоего
            пака ниже — у каждого своё видео и тексты, задаются один раз.
          </p>
          {languages.length ? (
            <div className="mt-3">
              <div className="text-[11.5px] text-dim">Твои языки в паке ({languages.length}):</div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {languages.map((l) => (
                  <span key={l.id} className="rounded-full border border-line bg-sub px-2.5 py-1 text-[11.5px] text-soft">
                    {localeName(l.locale)}{l.hasVideo || l.videoUrl ? '' : ' · без видео'}
                  </span>
                ))}
              </div>
            </div>
          ) : (
            <p className="mt-3 text-amber">Сначала заполни пак языков в разделе «Мои языки (для видео)» ниже.</p>
          )}
          <p className="mt-3 text-[11.5px] text-dim">Само создание видео-объявления с языками подключаю следующим шагом (нужен тестовый прогон на паузе).</p>
        </div>
      ) : (
      <>
      {/* КОНСТРУКТОР */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold text-soft">{editingId ? 'Правка залива' : 'Новый залив'}</span>
          {editingId ? <button type="button" onClick={resetConstructor} className="text-[11.5px] text-mute transition hover:text-text">отменить правку</button> : null}
        </div>

        {/* 1 · Овнер + кабинеты */}
        <div className={box}>
          <div className="flex flex-wrap items-center gap-2.5">
            <span className={stepBadge}>1</span>
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
            <div className="sticky top-0 flex items-center justify-between bg-sub px-3 py-1.5">
              <span className="text-[11.5px] font-semibold text-amber">{owner} · кабинеты</span>
              <button type="button" onClick={() => toggleAll(!ownerCabs.every((c) => selected.has(c.id)))} className="text-[11px] text-mute transition hover:text-sage">
                {ownerCabs.every((c) => selected.has(c.id)) ? 'снять все' : 'выбрать все'}
              </button>
            </div>
            {ownerCabs.map((c) => (
              <label key={c.id} className="flex cursor-pointer items-center gap-2.5 border-t border-line px-3 py-1.5 text-[12.5px] transition hover:bg-sub/60">
                <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} className="accent-[#b4c68c]" />
                <span className="min-w-0 flex-1 truncate text-soft">{c.name || c.externalId}</span>
                <span className="shrink-0 text-[11px] text-dim">{c.currency}</span>
              </label>
            ))}
            {ownerCabs.length === 0 ? <div className="px-3 py-3 text-[12px] text-mute">У этого овнера нет кабинетов.</div> : null}
          </div>

          {selectedList.length > 0 ? (
            <button type="button" onClick={loadAssets} disabled={pending} className={`mt-3 rounded-full border border-line2 bg-sub px-4 py-1.5 text-[12px] text-soft transition hover:border-sage hover:text-sage ${pending ? 'cursor-progress opacity-60' : ''}`}>
              {pending ? 'Читаю кабинеты…' : selectedList.every((c) => assets[c.id]) ? 'Обновить ФП/пиксели' : `Подтянуть ФП и пиксели (${selectedList.length})`}
            </button>
          ) : null}
          {/* Итог подтяжки — прямо под кнопкой, чтобы сбой был сразу заметен. */}
          {assetMsg ? (
            <div className="mt-2.5 rounded-[12px] border px-3 py-2 text-[12px]" style={assetMsg.ok ? { borderColor: '#3c4d33', background: '#1c241a', color: '#b4c68c' } : { borderColor: '#5a3a2a', background: '#2c1f1a', color: '#ce6e58' }}>
              {assetMsg.text}
            </div>
          ) : null}
        </div>

        {/* 2 · ФП + пиксель по кабинетам */}
        {anyAssets ? (
          <div className={box}>
            <div className="flex items-center gap-2.5">
              <span className={stepBadge}>2</span>
              <span className="text-[13px] font-semibold">Страница и пиксель по кабинетам</span>
            </div>
            <div className="mt-3 flex flex-col gap-2.5">
              {selectedList.map((c) => {
                const a = assets[c.id];
                if (!a) return <div key={c.id} className="rounded-[12px] border border-line px-3 py-2 text-[12px] text-mute">{c.name || c.externalId} — не подтянут.</div>;
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
                      <input value={newPageByAcc[c.id] ?? ''} onChange={(e) => setNewPageByAcc((n) => ({ ...n, [c.id]: e.target.value }))} placeholder="имя новой ФП" className={`${inp} max-w-[190px]`} />
                      <button type="button" onClick={() => addPage(c.id)} disabled={pending} className="rounded-full border border-line2 bg-sub px-3 py-1.5 text-[11.5px] text-soft transition hover:border-sage hover:text-sage">+ ФП</button>
                      <input value={newPixelByAcc[c.id] ?? ''} onChange={(e) => setNewPixelByAcc((n) => ({ ...n, [c.id]: e.target.value }))} placeholder="имя нового пикселя" className={`${inp} max-w-[190px]`} />
                      <button type="button" onClick={() => addPixel(c.id)} disabled={pending} className="rounded-full border border-line2 bg-sub px-3 py-1.5 text-[11.5px] text-soft transition hover:border-sage hover:text-sage">+ пиксель</button>
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
            <select value={templateId} onChange={(e) => onPickTemplate(e.target.value)} className={`${inp} max-w-[280px]`}>
              <option value="">— шаблон гео —</option>
              {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            {tpl ? <span className="rounded-full border border-line bg-sub px-3 py-1 text-[11.5px] text-mute">{tpl.countries}{tpl.excluded ? ` (−${tpl.excluded})` : ''} · {tpl.ageMin}-{tpl.ageMax} · {tpl.event} · {placementSummary(tpl.placements)}</span> : null}
          </div>
          <div className="mt-2.5 grid gap-2">
            <input value={campaignName} onChange={(e) => setCampaignName(e.target.value)} placeholder="Название кампании (оно же у адсета и объявлений)" className={inp} />
            <div className="grid gap-2 sm:grid-cols-[1fr_140px]">
              <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="Ссылка на лендинг (https://…)" className={inp} />
              <input value={budget} onChange={(e) => setBudget(e.target.value)} inputMode="decimal" placeholder="$/день" className={inp} />
            </div>
            <textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Текст объявления" rows={3} className="w-full rounded-xl border border-line2 bg-sub px-3 py-2 text-[12.5px] text-soft outline-none focus:border-sage" />
            <div className="grid gap-2 sm:grid-cols-2">
              <input value={headline} onChange={(e) => setHeadline(e.target.value)} placeholder="Заголовок (опц.)" className={inp} />
              <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Описание под ссылкой (опц.)" className={inp} />
            </div>
            {/* Ручной fb_pixel — вводится каждый залив (легко забыть), поэтому
                на видном месте и не запоминается. */}
            {urlTags.includes('{{fbpixel}}') || urlTags.includes('{{fb_pixel}}') ? (
              <div className="rounded-xl border border-amber/40 bg-amber-t/40 px-3 py-2">
                <div className="mb-1 text-[11.5px] font-semibold text-amber">fb_pixel — впиши вручную</div>
                <input value={manualPixel} onChange={(e) => setManualPixel(e.target.value)} inputMode="numeric" placeholder="напр. 5645645435" className={inp} />
                <p className="mt-1 text-[11px] text-dim">Подставится в метку <code className="text-mute">fb_pixel=…</code>. Вводишь при каждом заливе — не запоминаем.</p>
              </div>
            ) : null}
            <div>
              <input value={urlTags} onChange={(e) => setUrlTags(e.target.value)} className={inp} />
              <p className="mt-1 text-[11px] text-dim">Метки к ссылке. <code className="text-mute">{'{{pixel}}'}</code> → пиксель кабинета, <code className="text-mute">{'{{fbpixel}}'}</code> → номер fb_pixel выше; <code className="text-mute">{'{{ad.id}}'}</code>, <code className="text-mute">{'{{campaign.id}}'}</code>, <code className="text-mute">{'{{account.id}}'}</code> подставит ФБ.</p>
            </div>
          </div>
        </div>

        {/* 4 · Креативы */}
        <div className={box}>
          <div className="flex items-center gap-2.5">
            <span className={stepBadge}>4</span>
            <span className="text-[13px] font-semibold">Креативы</span>
            {files.length > 0 ? <span className="ml-auto text-[12px] text-sage">{files.length} шт.</span> : null}
          </div>
          <p className="mt-1.5 text-[11px] text-mute">Каждая картинка — отдельное объявление. До 20 штук. Авто-улучшения Меты отключаем.</p>
          <input ref={fileInput} type="file" accept="image/*" multiple onChange={(e) => addFiles(e.target.files)} className="mt-2 block w-full text-[12px] text-soft file:mr-3 file:rounded-full file:border file:border-line2 file:bg-sub file:px-4 file:py-1.5 file:text-[12px] file:text-soft hover:file:border-sage" />
          {files.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {files.map((f, i) => (
                <span key={`${f.name}${i}`} className="flex items-center gap-1.5 rounded-full border border-line bg-sub px-2.5 py-1 text-[11px] text-soft">
                  <span className="max-w-[140px] truncate">{f.name}</span>
                  <button type="button" onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))} className="text-mute transition hover:text-rust">×</button>
                </span>
              ))}
            </div>
          ) : null}
        </div>

        {/* 5 · Режим */}
        <div className={box}>
          <div className="flex items-center gap-2.5">
            <span className={stepBadge}>5</span>
            <span className="text-[13px] font-semibold">Режим запуска</span>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {(['paused', 'active', 'scheduled'] as const).map((v) => (
              <button key={v} type="button" onClick={() => setMode(v)} className={`rounded-full border px-3.5 py-1.5 text-[12px] transition ${mode === v ? 'border-sage bg-sage-t text-sage' : 'border-line2 bg-sub text-soft hover:border-sage'}`}>
                {v === 'paused' ? 'На паузе' : v === 'active' ? 'Сразу в актив' : 'По расписанию'}
              </button>
            ))}
            {/* Дата держит место (invisible), чтобы ряд кнопок не дёргался; при
                «по расписанию» проявляется справа. */}
            <input
              value={startLocal}
              onChange={(e) => setStartLocal(e.target.value)}
              type="datetime-local"
              tabIndex={mode === 'scheduled' ? 0 : -1}
              aria-hidden={mode !== 'scheduled'}
              className={`h-9 w-[200px] rounded-xl border border-line2 bg-sub px-3 text-[12.5px] text-soft outline-none focus:border-sage ${mode === 'scheduled' ? '' : 'invisible'}`}
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button type="button" onClick={addToQueue} className="rounded-full border border-sage bg-sage-t px-5 py-2 text-[12.5px] font-medium text-sage transition hover:brightness-110">
            {editingId ? 'Сохранить черновик' : '+ Добавить в очередь'}
          </button>
          {msg ? (
            <span className="text-[11.5px]" style={{ color: msg.ok ? '#b4c68c' : '#ce6e58' }}>{msg.text}</span>
          ) : null}
        </div>
      </div>

      {/* ОЧЕРЕДЬ */}
      <div className="rounded-[16px] border border-line2 bg-panel/60 p-4 sm:p-5">
        <div className="flex items-center gap-2.5">
          <span className="text-[14px] font-semibold">Очередь заливов</span>
          <span className="text-[12px] text-mute">{queue.length} заливов · {totalTargets} кабинетов</span>
        </div>

        {queue.length === 0 ? (
          <p className="mt-3 text-[12px] text-mute">Пусто. Собери залив выше и добавь в очередь — можно подготовить сразу несколько, а потом запустить всё одной кнопкой.</p>
        ) : (
          <div className="mt-3 flex flex-col gap-2">
            {queue.map((d) => {
              const t = templates.find((x) => x.id === d.templateId);
              return (
                <div key={d.id} className={`rounded-[12px] border px-3.5 py-2.5 ${editingId === d.id ? 'border-sage' : 'border-line'}`}>
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-amber-t px-2 py-0.5 text-[10.5px] text-amber">{d.owner}</span>
                    <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-soft">{d.campaignName || 'без имени'}</span>
                    <span className="shrink-0 text-[11px] text-mute">{modeLabel(d.mode)}</span>
                    <button type="button" onClick={() => editDraft(d)} className="shrink-0 rounded-full border border-line2 px-2.5 py-1 text-[11px] text-mute transition hover:border-sage hover:text-sage">править</button>
                    <button type="button" onClick={() => removeDraft(d.id)} className="shrink-0 rounded-full border border-line2 px-2.5 py-1 text-[11px] text-mute transition hover:border-rust hover:text-rust">убрать</button>
                  </div>
                  <div className="mt-1.5 text-[11px] text-dim">
                    {d.cabinetIds.length} каб. · {t?.name ?? 'шаблон?'} · {d.files.length} карт.{d.budget ? ` · $${d.budget}/д` : ''}{d.mode === 'scheduled' && d.startLocal ? ` · старт ${d.startLocal.replace('T', ' ')}` : ''}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {progress ? <div className="mt-3 text-[12px] text-mute">Заливаю… {progress.done}/{progress.total}</div> : null}

        {confirm && hasLive ? (
          <div className="mt-3 flex flex-wrap items-center gap-2.5 rounded-[12px] border px-3 py-2.5 text-[12.5px]" style={{ borderColor: '#5a3a2a', background: '#241712' }}>
            <span className="text-soft">Запустить всю очередь?</span>
            <div className="ml-auto flex items-center gap-2">
              <button type="button" onClick={fireAll} disabled={pending} className="rounded-full border border-sage px-3.5 py-1.5 text-[12px] text-sage transition hover:bg-sage-t">Подтвердить</button>
              <button type="button" onClick={() => setConfirm(false)} className="rounded-full border border-line2 px-3.5 py-1.5 text-[12px] text-mute transition hover:text-text">Отмена</button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={onFireClick} disabled={pending || queue.length === 0} className={`mt-3 rounded-full border border-sage bg-sage-t px-6 py-2.5 text-[13px] font-semibold text-sage transition hover:brightness-110 ${pending || queue.length === 0 ? 'opacity-50' : ''}`}>
            {pending ? 'Заливаю…' : `Залить всё${totalTargets ? ` (${totalTargets})` : ''}`}
          </button>
        )}

        {/* Результаты */}
        {Object.keys(results).length ? (
          <div className="mt-3 flex flex-col gap-1.5">
            {Object.entries(results).map(([key, r]) => {
              const open = openLog === key;
              return (
                <div key={key} className="rounded-[12px] border border-line bg-sub px-3.5 py-2.5">
                  <div className="flex items-center gap-2 text-[12.5px]">
                    <span className={r.ok ? 'text-sage' : 'text-rust'}>{r.ok ? '✓' : '✗'}</span>
                    <span className="min-w-0 flex-1 truncate text-soft">{r.label}</span>
                    <span className="shrink-0 text-[11.5px] text-mute">{r.ok ? `${r.adsCreated} объявл.` : (r.error ?? 'ошибка')}</span>
                    {r.log?.length ? <button type="button" onClick={() => setOpenLog(open ? '' : key)} className="shrink-0 text-[11px] text-mute transition hover:text-sage">{open ? 'скрыть' : 'журнал'}</button> : null}
                  </div>
                  {open && r.log?.length ? <pre className="scroll-slim mt-2 max-h-[220px] overflow-auto whitespace-pre-wrap text-[11px] leading-relaxed text-dim">{r.log.join('\n')}</pre> : null}
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
      </>
      )}
    </div>
  );
}
