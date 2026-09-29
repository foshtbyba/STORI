'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { loadCabinetAssets, makePixel, makePage, startUpload } from '@/app/actions/autoupload';
import ComboSelect from './ComboSelect';
import TemplatePicker from './TemplatePicker';
import JobsJournal from './JobsJournal';
import type { Template } from './TemplateManager';
import type { Language } from './LanguagePack';
import { localeName } from '@/lib/locales';

type Cabinet = { id: string; name: string; externalId: string; currency: string; group: string };
type Asset = { pages: { id: string; name: string; valid?: boolean; reason?: string }[]; pixels: { id: string; name: string }[] };
type Mode = 'paused' | 'active' | 'midnight' | 'scheduled';

type VideoDraft = {
  id: string;
  owner: string;
  cabId: string; cabLabel: string;
  pageId: string; pixelId: string;
  templateId: string; tplName: string;
  campaignName: string; link: string; budget: string;
  message: string; headline: string; description: string;
  fbPixelKey: string; fbPixelNum: string; mode: Mode; startLocal: string;
  withLanguages: boolean;
  videos: File[];    // один или несколько роликов — каждый станет объявлением
  structure: string; // 1-1-1 | 1-2-1 | 1-1-2 — как раскладываем ролики
};

const uid = () => Math.random().toString(36).slice(2, 9);

// Единый визуальный язык с обычным заливом (AutouploadForm): те же box, поле,
// нумерованные шаги.
const inp = 'h-9 w-full rounded-xl border border-line2 bg-sub px-3 text-[12.5px] text-soft outline-none focus:border-sage';
const box = 'rounded-[16px] border border-line bg-panel/40 px-4 py-4 sm:px-5';
const stepBadge = 'flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sage-t text-[12px] font-semibold text-sage';

// Замок запуска на уровне модуля (см. AutouploadForm): защищает от второго
// параллельного fireAll при перемонтировании — чтобы залив не ушёл дважды.
let fireLock = false;

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
export default function VideoUpload({ cabinets, templates, languages = [], admin = false }: { cabinets: Cabinet[]; templates: Template[]; languages?: Language[]; admin?: boolean }) {
  const [pending, start] = useTransition();
  // Синхронный замок от дабл-клика (pending обновляется асинхронно) — иначе два
  // быстрых клика запускают залив дважды и в журнале появляется дубль.
  const firing = useRef(false);
  // Подтверждение запуска — как в сторис-заливе: если хоть один залив идёт не на
  // паузе, сначала спрашиваем «точно залить?», и только вторым кликом стартуем.
  const [confirm, setConfirm] = useState(false);

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
  // Что сейчас создаётся: `${accId}:pixel` / `${accId}:page` — чтобы показать
  // «создаю…» на нужной кнопке сразу после клика.
  const [creating, setCreating] = useState('');
  const [assetMsg, setAssetMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [templateId, setTemplateId] = useState('');
  const [campaignName, setCampaignName] = useState('');
  const [link, setLink] = useState('');
  const [budget, setBudget] = useState('');
  const [message, setMessage] = useState('');
  const [headline, setHeadline] = useState('');
  const [description, setDescription] = useState('');
  // Метка fb_pixel в ссылке собирается из двух частей (fbpx=ПИКСЕЛЬ подставляем
  // автоматически — пиксель кабинета, отдельного поля не надо):
  //  • ключ (часть до «=», обычно fb_pixel) — меняется редко, ЗАПОМИНАЕМ за
  //    баером/овнер-именем;
  //  • число (после «=», напр. 5645645435) — меняется часто, НЕ запоминаем.
  const [fbPixelKey, setFbPixelKey] = useState('fb_pixel');
  const [fbPixelNum, setFbPixelNum] = useState('');
  const [mode, setMode] = useState<Mode>('paused');
  const [startLocal, setStartLocal] = useState('');
  const [withLanguages, setWithLanguages] = useState(languages.length > 0);
  const [videos, setVideos] = useState<File[]>([]);
  // Структура публикации роликов (несколько роликов — одним заливом на гео).
  // По умолчанию 1-1-1 (каждый ролик — своя кампания/адсет/объявление).
  const [structure, setStructure] = useState('1-1-1');
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

  // Ключ fb_pixel запоминаем ЗА ОВНЕР-ИМЕНЕМ (для баера owner = его хэндл, для
  // овнера — SKO/MPR). Число (fbPixelNum) не запоминаем — оно меняется часто.
  useEffect(() => {
    if (!owner) return;
    try { setFbPixelKey(localStorage.getItem(`videoupload:fbpixelkey:${owner}`) || 'fb_pixel'); } catch { /* игнор */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner]);
  useEffect(() => {
    if (!owner) return;
    try { localStorage.setItem(`videoupload:fbpixelkey:${owner}`, fbPixelKey); } catch { /* игнор */ }
  }, [owner, fbPixelKey]);

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
        // Сразу выбираем ПЕРВУЮ ГОДНУЮ ФП (разрешённую кабинетом) и первый
        // пиксель, чтобы поля не были пустыми. Негодные ФП не подставляем.
        if (!nP[id]) {
          const firstValid = (r.pages ?? []).find((p) => p.valid) ?? undefined;
          if (firstValid) nP[id] = firstValid.id;
        }
        if ((r.pixels?.length ?? 0) >= 1 && !nX[id]) nX[id] = r.pixels![0].id;
      }
      setAssets(nA); setPageByAcc(nP); setPixelByAcc(nX);
      if (fails.length) setAssetMsg({ ok: false, text: `Не подтянулось: ${fails.join(' · ')}` });
      else if (okCount) setAssetMsg({ ok: true, text: 'ФП и пиксели подтянуты.' });
    });
  };

  const addPixel = (accId: string) => {
    if (pending) return;
    setMsg('');
    setCreating(`${accId}:pixel`);
    start(async () => {
      try {
        const r = await makePixel(accId, newPixelByAcc[accId] ?? '');
        if (!r.ok) { setMsg(r.error ?? 'сбой создания пикселя'); return; }
        setAssets((a) => ({ ...a, [accId]: { pages: a[accId]?.pages ?? [], pixels: r.pixels ?? [] } }));
        { const pick = r.createdId ?? (r.pixels?.length ? r.pixels[r.pixels.length - 1].id : ''); if (pick) setPixelByAcc((p) => ({ ...p, [accId]: pick })); }
        setNewPixelByAcc((n) => ({ ...n, [accId]: '' }));
      } finally { setCreating(''); }
    });
  };

  const addPage = (accId: string) => {
    if (pending) return;
    const name = (newPageByAcc[accId] ?? '').trim();
    if (!name) { setMsg('Впиши имя новой страницы'); return; }
    setMsg('');
    setCreating(`${accId}:page`);
    start(async () => {
      try {
      const r = await makePage(accId, name);
      if (!r.ok) { setMsg(r.error ?? 'сбой создания страницы'); return; }
      setAssets((a) => ({ ...a, [accId]: { pages: r.pages ?? [], pixels: a[accId]?.pixels ?? [] } }));
      { const pick = r.createdId ?? (r.pages?.length ? r.pages[r.pages.length - 1].id : ''); if (pick) setPageByAcc((p) => ({ ...p, [accId]: pick })); }
      setNewPageByAcc((n) => ({ ...n, [accId]: '' }));
      } finally { setCreating(''); }
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
    if (videos.length === 0 && !mainOptional) return 'Добавь хотя бы один ролик (видеофайл) или включи языки с видео';
    if (!/^https?:\/\//i.test(link.trim())) return 'Ссылка должна начинаться с http(s)://';
    if (!message.trim()) return 'Текст объявления пустой';
    if (!fbPixelNum.trim()) return 'Впиши число fb_pixel';
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
      owner,
      cabId: c.id, cabLabel: c.name || c.externalId,
      pageId: pageByAcc[c.id], pixelId: pixelByAcc[c.id],
      templateId, tplName: tpl?.name ?? '',
      campaignName: campaignName.trim(), link: link.trim(), budget: budget.trim(),
      message: message.trim(), headline: headline.trim(), description: description.trim(),
      fbPixelKey: (fbPixelKey.trim() || 'fb_pixel'), fbPixelNum: fbPixelNum.trim(), mode, startLocal,
      withLanguages,
      videos,
      structure,
    }));
    setQueue((q) => [...q, ...drafts]);
    setVideos([]);
    if (fileRef.current) fileRef.current.value = '';
    setCampaignName(''); setLink(''); setMessage(''); setHeadline(''); setDescription('');
    setFbPixelNum(''); // число меняется часто — чистим; ключ (fbPixelKey) оставляем.
    autoName.current = '';
    setMsg(`Добавлено в очередь: ${drafts.length} (по кабинетам). Собери ещё или жми «Залить всё».`);
  };


  // Клик по «Залить»: пустая очередь — подсказка; есть живой залив — сперва
  // просим подтверждение (баннер ниже), иначе запускаем сразу.
  const onFireClick = () => {
    if (queue.length === 0) { setMsg('Очередь пуста — собери хотя бы один залив'); return; }
    if (!confirm) { setConfirm(true); return; }
    fireAll();
  };

  const fireAll = () => {
    setMsg('');
    if (fireLock || firing.current || pending) return;
    if (queue.length === 0) { setMsg('Очередь пуста — собери хотя бы один залив'); return; }
    fireLock = true;
    firing.current = true;
    setConfirm(false);
    start(async () => {
      try {
      for (const d of queue) {
        const fd = new FormData();
        fd.set('accountId', d.cabId);
        // Ключ запуска (см. AutouploadForm): случайный дубль отобьётся, а
        // намеренно одинаковые заливы — разные черновики, разные ключи.
        fd.set('uploadKey', `${d.id}:${d.cabId}`);
        fd.set('templateId', d.templateId);
        fd.set('pageId', d.pageId);
        fd.set('pixelId', d.pixelId);
        fd.set('campaignName', d.campaignName);
        fd.set('link', d.link);
        fd.set('budget', d.budget);
        fd.set('message', d.message);
        fd.set('headline', d.headline);
        fd.set('description', d.description);
        // fbpx=ПИКСЕЛЬ — автоподстановка пикселя кабинета ({{pixel}}).
        // fb_pixel собираем сами: <ключ>=<число> (ключ запомнен, число — из формы).
        const tags = `ad_id={{ad.id}}&fbpx={{pixel}}&${d.fbPixelKey || 'fb_pixel'}=${d.fbPixelNum}&account_id={{account.id}}&campaign_id={{campaign.id}}`;
        fd.set('urlTags', tags);
        fd.set('mode', d.mode);
        fd.set('structure', d.structure || '1-1-1');
        if (d.withLanguages) fd.set('withLanguages', '1');
        if (d.mode === 'midnight') fd.set('startAt', nextMoscowMidnight());
        if (d.mode === 'scheduled' && d.startLocal) fd.set('startAt', new Date(d.startLocal).toISOString());
        for (const v of d.videos) fd.append('video', v);
        const r = await startUpload(fd);
        if (!r.ok) throw new Error(r.error || 'сервер отклонил запуск');
      }
      const n = queue.length;
      setQueue([]);
      // Единый текст со сторис-заливом: статусы — в списке ниже.
      setMsg(`Запущено в фоне: ${n}. Статусы — в списке ниже, можно уйти со страницы.`);
      setJournalKey((k) => k + 1);
      } catch (e) {
        setMsg(`Не удалось запустить: ${(e as Error).message || 'ошибка сети'}. Очередь не тронута — попробуй ещё раз.`);
      } finally {
        firing.current = false;
        fireLock = false;
      }
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <span className="text-[13px] font-semibold text-soft">Новый залив</span>
      </div>

      {/* 1 · Кабинеты + 2 · Ролик и языки — в две колонки, чтобы справа не пустовало место. */}
      <div className="grid gap-4 lg:grid-cols-2">
      {/* Левый бокс не задаёт высоту сам (внутренний слой абсолютный на lg),
          поэтому строка грида равна ПРАВОМУ боксу, а не списку кабинетов —
          колонки одинаковые, а кабинеты листаются внутри. min-h — пол, чтобы
          список не схлопнулся, если справа мало контента. */}
      <div className={`${box} flex flex-col lg:relative lg:min-h-[300px] lg:overflow-hidden`}>
       <div className="flex flex-1 flex-col lg:absolute lg:inset-0 lg:px-5 lg:py-4">
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

        {/* Шапка поиска вне прокрутки (не sticky) — иначе кабинеты просвечивали
            над ней в скруглённых углах. Скроллятся только строки. */}
        <div className="mt-3 flex min-h-0 flex-1 flex-col overflow-hidden rounded-[12px] border border-line">
          <div className="flex items-center gap-2 border-b border-line bg-sub px-3 py-1.5">
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
          <div className="scroll-slim min-h-0 flex-1 overflow-y-auto">
            {visibleCabs.map((c) => (
              <label key={c.id} className="flex cursor-pointer items-center gap-2.5 border-t border-line px-3 py-1.5 text-[12.5px] transition first:border-t-0 hover:bg-sub/60">
                <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} className="shrink-0 accent-[#b4c68c]" />
                <span className="min-w-0 flex-1 truncate text-soft">{c.name || c.externalId}</span>
                {c.name && c.name !== c.externalId ? (
                  <span className="n w-[170px] shrink-0 truncate text-right text-[11px] text-dim">{c.externalId}</span>
                ) : null}
                <span className="w-8 shrink-0 text-right text-[11px] text-dim">{c.currency}</span>
              </label>
            ))}
            {ownerCabs.length === 0 ? (
              <div className="px-3 py-3 text-[12px] text-mute">У этого овнера нет кабинетов.</div>
            ) : visibleCabs.length === 0 ? (
              <div className="px-3 py-3 text-[12px] text-mute">Ничего не найдено по «{qCab.trim()}».</div>
            ) : null}
          </div>
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
      </div>

      {/* 2 · Ролик и языки — справа от кабинетов */}
      <div className={box}>
        <div className="flex items-center gap-2.5">
          <span className={stepBadge}>2</span>
          <span className="text-[13px] font-semibold">Ролик и языки</span>
          {videos.length ? <span className="ml-auto text-[12px] text-sage">{videos.length} ролик(ов)</span> : null}
        </div>
        <div className="mt-3 grid gap-3">
          <div>
            <div className="lab mb-1">Ролики (видеофайлы) {mainOptional ? <span className="text-dim">— целевые, на языке гео; каждый = своё объявление</span> : <span className="text-amber">— хотя бы один</span>}</div>
            <input ref={fileRef} type="file" accept="video/*" multiple onChange={(e) => { setVideos((prev) => [...prev, ...Array.from(e.target.files ?? [])]); if (fileRef.current) fileRef.current.value = ''; }} className="block w-fit max-w-full text-[12px] text-soft file:mr-3 file:rounded-full file:border file:border-line2 file:bg-sub file:px-4 file:py-1.5 file:text-[12px] file:text-soft hover:file:border-sage" />
            {videos.length ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {videos.map((f, i) => (
                  <span key={`${f.name}${i}`} className="flex items-center gap-1.5 rounded-full border border-line bg-sub px-2.5 py-1 text-[11px] text-soft">
                    <span className="max-w-[160px] truncate">🎬 {f.name}</span>
                    <span className="text-dim">{(f.size / 1024 / 1024).toFixed(1)} МБ</span>
                    <button type="button" onClick={() => setVideos((prev) => prev.filter((_, j) => j !== i))} className="text-mute transition hover:text-rust">×</button>
                  </span>
                ))}
              </div>
            ) : null}
            {mainOptional ? (
              <p className="mt-1.5 text-[11px] text-dim">Это ЦЕЛЕВЫЕ ролики на языке гео (язык определится по шаблону: BG → болгарский). Каждый ролик станет отдельным объявлением; в мультиязычном режиме он идёт ПОСЛЕДНИМ слоем с этим текстом/ссылкой, дефолтом — первый язык пака. Не приложишь ни одного — зальются только языки пака (одно объявление).</p>
            ) : (
              <p className="mt-1.5 text-[11px] text-dim">Нужен хотя бы один ролик (или языки с видео). Несколько роликов = несколько объявлений за один залив — как разложить, ниже.</p>
            )}
          </div>
        </div>
        <label className="mt-3 flex cursor-pointer items-center gap-2 border-t border-line pt-3 text-[12.5px] font-semibold text-soft">
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
          <p className="mt-2 text-[11px] text-dim">Слои: дефолт — первый язык пака (нетипичный для гео), затем остальные языки пака, а ПОСЛЕДНИМ — целевой ролик на языке гео (по шаблону) с его текстом/ссылкой. Языки без видео пропустятся.</p>
        ) : null}

        {/* Структура публикации ролика — наполнить гео одним заливом. */}
        <div className="mt-3 border-t border-line pt-3">
          <div className="lab mb-1.5">Как раскладываем ролики</div>
          <div className="flex flex-wrap items-center gap-1.5">
            {(['1-1-1', '1-2-1', '1-1-2'] as const).map((val) => (
              <button key={val} type="button" onClick={() => setStructure(val)} className={`n rounded-full border px-4 py-1.5 text-[12px] font-medium transition ${structure === val ? 'border-sage bg-sage-t text-sage' : 'border-line2 bg-sub text-soft hover:border-sage'}`}>
                {val}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-[11px] text-dim">
            {videos.length <= 1
              ? 'Один ролик — одно объявление. Догрузи ещё ролики выше, чтобы одним заливом сделать несколько (каждый ролик = своё объявление).'
              : structure === '1-1-2'
                ? `1 кампания / 1 адсет / ${videos.length} объявлений (по ролику) — общий бюджет адсета.`
                : structure === '1-2-1'
                  ? `1 кампания / ${videos.length} адсетов (по ролику, свой бюджет) — ${videos.length}× расход.`
                  : `${videos.length} кампаний (по ролику, свой бюджет) — ${videos.length}× расход.`}
            {' '}Каждый ролик грузится и становится отдельным объявлением.
          </p>
        </div>
      </div>
      </div>

      {/* 3 · ФП + пиксель по кабинетам */}
      {anyAssets ? (
        <div className={box}>
          <div className="flex items-center gap-2.5">
            <span className={stepBadge}>3</span>
            <span className="text-[13px] font-semibold">Страница и пиксель по кабинетам</span>
          </div>
          <div className="mt-3 flex flex-col gap-2.5">
            {selectedList.map((c) => {
              const a = assets[c.id];
              if (!a) return <div key={c.id} className="rounded-[12px] border border-line px-3 py-2 text-[12px] text-mute">{c.name || c.externalId} — не подтянут.</div>;
              return (
                <div key={c.id} className="rounded-[12px] border border-line px-3 py-2.5">
                  <div className="text-[12px] font-medium text-soft">{c.name || c.externalId}</div>
                  {/* 4 колонки: выбрать ФП · создать ФП · выбрать пиксель · создать пиксель. */}
                  <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                    <ComboSelect
                      className="w-full"
                      value={pageByAcc[c.id] ?? ''}
                      onChange={(v) => setPageByAcc((p) => ({ ...p, [c.id]: v }))}
                      placeholder="— страница (ФП) —"
                      searchPlaceholder="Поиск ФП…"
                      options={a.pages.map((p) => ({ id: p.id, name: p.name, disabled: p.valid === false, hint: p.reason }))}
                    />
                    <div className="flex items-center gap-2">
                      <input value={newPageByAcc[c.id] ?? ''} onChange={(e) => setNewPageByAcc((n) => ({ ...n, [c.id]: e.target.value }))} placeholder="имя новой ФП" className={`${inp} min-w-0 flex-1`} />
                      <button type="button" onClick={() => addPage(c.id)} disabled={pending} className={`shrink-0 rounded-full border px-3 py-1.5 text-[11.5px] transition ${creating === `${c.id}:page` ? 'border-sage bg-sage-t text-sage' : 'border-line2 bg-sub text-soft hover:border-sage hover:text-sage'}`}>{creating === `${c.id}:page` ? 'создаю…' : '+ ФП'}</button>
                    </div>
                    <ComboSelect
                      className="w-full"
                      value={pixelByAcc[c.id] ?? ''}
                      onChange={(v) => setPixelByAcc((p) => ({ ...p, [c.id]: v }))}
                      placeholder="— пиксель —"
                      searchPlaceholder="Поиск пикселя…"
                      options={a.pixels.map((p) => ({ id: p.id, name: p.name }))}
                    />
                    <div className="flex items-center gap-2">
                      <input value={newPixelByAcc[c.id] ?? ''} onChange={(e) => setNewPixelByAcc((n) => ({ ...n, [c.id]: e.target.value }))} placeholder="имя нового пикселя" className={`${inp} min-w-0 flex-1`} />
                      <button type="button" onClick={() => addPixel(c.id)} disabled={pending} className={`shrink-0 rounded-full border px-3 py-1.5 text-[11.5px] transition ${creating === `${c.id}:pixel` ? 'border-sage bg-sage-t text-sage' : 'border-line2 bg-sub text-soft hover:border-sage hover:text-sage'}`}>{creating === `${c.id}:pixel` ? 'создаю…' : '+ пиксель'}</button>
                    </div>
                  </div>
                  {a.pages.length === 0 ? (
                    <p className="mt-1.5 text-[11px] text-rust">нет страниц под токеном — создай ФП слева</p>
                  ) : !a.pages.some((p) => p.valid !== false) ? (
                    <p className="mt-1.5 text-[11px] text-rust">нет ГОДНЫХ ФП для этого кабинета (все не разрешены/не опубликованы) — залив не пройдёт, разбань/подключи страницу</p>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* Шаблон гео и объявление. Номер динамический (шаг ФП/пиксель условный). */}
      <div className={box}>
        <div className="flex items-center gap-2.5">
          <span className={stepBadge}>{anyAssets ? 4 : 3}</span>
          <span className="text-[13px] font-semibold">Шаблон гео и объявление</span>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <TemplatePicker templates={templates} value={templateId} onPick={onPickTemplate} />
          {tpl ? <span className="rounded-full border border-line bg-sub px-3 py-1 text-[11.5px] text-mute">{tpl.countries} · {tpl.event}</span> : null}
          {/* Ссылка на объявление и бюджет — справа от поиска шаблона. */}
          <div className="ml-auto flex items-center gap-2">
            <input value={link} onChange={(e) => setLink(e.target.value.replace(/\s+/g, ''))} type="url" placeholder="Ссылка на объявление (https://…)" className="h-9 w-[240px] max-w-full rounded-xl border border-line2 bg-sub px-3 text-[12.5px] text-soft outline-none focus:border-sage" />
            <input value={budget} onChange={(e) => setBudget(e.target.value)} inputMode="decimal" placeholder="$/день" className="h-9 w-[90px] rounded-xl border border-line2 bg-sub px-3 text-[12.5px] text-soft outline-none focus:border-sage" />
          </div>
        </div>
        <div className="mt-2.5 grid gap-2">
          <input value={campaignName} onChange={(e) => setCampaignName(e.target.value)} placeholder="Название кампании (оно же у адсета и объявлений)" className={inp} />
          <textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Текст объявления" rows={3} className="w-full rounded-xl border border-line2 bg-sub px-3 py-2 text-[12.5px] text-soft outline-none focus:border-sage" />
          <div className="grid gap-2 sm:grid-cols-2">
            <input value={headline} onChange={(e) => setHeadline(e.target.value)} placeholder="Заголовок (опц.)" className={inp} />
            <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Описание под ссылкой (опц.)" className={inp} />
          </div>
          <div className="rounded-xl border border-amber/40 bg-amber-t/40 px-3 py-2">
            <div className="mb-1 text-[11.5px] font-semibold text-amber">Метка fb_pixel в ссылке <span className="font-normal text-dim">· fbpx подставим автоматически (пиксель кабинета)</span></div>
            <div className="grid gap-2 sm:grid-cols-[200px_1fr]">
              <div>
                <input value={fbPixelKey} onChange={(e) => setFbPixelKey(e.target.value.trim())} placeholder="fb_pixel" className={`n ${inp}`} />
                <p className="mt-1 text-[11px] text-dim">Ключ (до «=») · меняется редко, запоминаем за {owner || 'вами'}.</p>
              </div>
              <div>
                <input value={fbPixelNum} onChange={(e) => setFbPixelNum(e.target.value.replace(/\D/g, ''))} inputMode="numeric" placeholder="напр. 5645645435" className={`n ${inp}`} />
                <p className="mt-1 text-[11px] text-dim">Число (после «=») · меняется часто, вставляй каждый залив.</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Режим запуска. Кнопка «в очередь» — ниже, под кнопками режима. */}
      <div className={box}>
        <div className="flex items-center gap-2.5">
          <span className={stepBadge}>{anyAssets ? 5 : 4}</span>
          <span className="text-[13px] font-semibold">Режим запуска</span>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {(['paused', 'active', 'midnight', 'scheduled'] as const).map((m) => (
            <button key={m} type="button" onClick={() => setMode(m)} className={`rounded-full border px-3.5 py-1.5 text-[12px] transition ${mode === m ? 'border-sage bg-sage-t text-sage' : 'border-line2 bg-sub text-soft hover:border-sage'}`}>
              {m === 'paused' ? 'На паузе' : m === 'active' ? 'Сразу в актив' : m === 'midnight' ? 'С 00:00 МСК' : 'По расписанию'}
            </button>
          ))}
          <input
            value={startLocal}
            onChange={(e) => setStartLocal(e.target.value)}
            type="datetime-local"
            tabIndex={mode === 'scheduled' ? 0 : -1}
            aria-hidden={mode !== 'scheduled'}
            className={`h-9 w-[200px] rounded-xl border border-line2 bg-sub px-3 text-[12.5px] text-soft outline-none focus:border-sage ${mode === 'scheduled' ? '' : 'invisible'}`}
          />
        </div>
        {/* Кнопка «в очередь» — отдельной строкой ниже кнопок режима. */}
        <div className="mt-3 flex items-center gap-2 border-t border-line pt-3">
          <button type="button" onClick={addToQueue} className="rounded-full border border-sage bg-sage-t px-5 py-2 text-[12.5px] font-medium text-sage transition hover:brightness-110">
            + Добавить в очередь{selectedList.length > 1 ? ` (${selectedList.length})` : ''}
          </button>
          {msg ? <span className="text-[11.5px] text-sage">{msg}</span> : null}
        </div>
      </div>

      {/* ОЧЕРЕДЬ — показываем только когда в ней что-то есть. */}
      {queue.length > 0 ? (
      <div className="rounded-[16px] border border-line2 bg-panel/60 p-4 sm:p-5">
        <div className="flex items-center gap-2.5">
          <span className="text-[14px] font-semibold">Очередь заливов</span>
          <span className="text-[12px] text-mute">{queue.length} заливов · {queue.length} кабинетов</span>
        </div>
        <div className="mt-3 flex flex-col gap-2">
          {queue.map((d) => (
            <div key={d.id} className="rounded-[12px] border border-line px-3.5 py-2.5">
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-amber-t px-2 py-0.5 text-[10.5px] text-amber">{d.owner}</span>
                <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-soft">{d.campaignName || 'без имени'} <span className="text-mute">· {d.cabLabel}</span></span>
                <span className="shrink-0 text-[11px] text-mute">{d.mode === 'paused' ? 'на паузе' : d.mode === 'active' ? 'в актив' : d.mode === 'midnight' ? 'с 00:00 МСК' : 'по расписанию'}</span>
                <button type="button" onClick={() => setQueue((q) => q.filter((x) => x.id !== d.id))} className="shrink-0 rounded-full border border-line2 px-2.5 py-1 text-[11px] text-mute transition hover:border-rust hover:text-rust">убрать</button>
              </div>
              <div className="mt-1.5 text-[11px] text-dim">{d.tplName || 'шаблон?'} · 🎬 {d.videos.length ? `${d.videos.length} ролик(ов) · ${d.structure}` : 'ролики из пака языков'}{d.withLanguages ? ' · +языки' : ''}{d.budget ? ` · $${d.budget}/д` : ''}</div>
            </div>
          ))}
        </div>
        {confirm ? (
          <div className="mt-3 flex flex-wrap items-center gap-2.5 rounded-[12px] border px-3 py-2.5 text-[12.5px]" style={{ borderColor: '#5a3a2a', background: '#241712' }}>
            <span className="text-soft">Запустить всю очередь?</span>
            <div className="ml-auto flex items-center gap-2">
              <button type="button" onClick={fireAll} disabled={pending} className="rounded-full border border-sage px-3.5 py-1.5 text-[12px] text-sage transition hover:bg-sage-t">Подтвердить</button>
              <button type="button" onClick={() => setConfirm(false)} className="rounded-full border border-line2 px-3.5 py-1.5 text-[12px] text-mute transition hover:text-text">Отмена</button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={onFireClick} disabled={pending} className={`mt-3 rounded-full border border-sage bg-sage-t px-6 py-2.5 text-[13px] font-semibold text-sage transition hover:brightness-110 ${pending ? 'opacity-50' : ''}`}>
            {pending ? 'Заливаю…' : `Залить всё (${queue.length})`}
          </button>
        )}
      </div>
      ) : null}

      {/* Баеру — его выполненные видео-заливы (раскрыты, из БД, переживают
          обновление). Админу — общая стата. */}
      <JobsJournal
        key={journalKey}
        kind="video"
        defaultExpanded={!admin}
        title={admin ? 'Журнал видео-заливов · общая стата' : 'Мои видео-заливы'}
      />
    </div>
  );
}
