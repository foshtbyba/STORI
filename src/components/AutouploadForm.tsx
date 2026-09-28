'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { loadCabinetAssets, makePixel, makePage, startUpload } from '@/app/actions/autoupload';
import ComboSelect from './ComboSelect';
import TemplateManager, { type Template } from './TemplateManager';
import TemplatePicker from './TemplatePicker';
import CardBinder from './CardBinder';
import VideoUpload from './VideoUpload';
import JobsJournal from './JobsJournal';
import LanguagePack, { type Language } from './LanguagePack';
import { placementSummary } from '@/lib/placements';

type Cabinet = { id: string; name: string; externalId: string; currency: string; group: string };
type Asset = { pages: { id: string; name: string; valid?: boolean; reason?: string }[]; pixels: { id: string; name: string }[] };
type Mode = 'paused' | 'active' | 'scheduled' | 'midnight';

// Замок запуска на УРОВНЕ МОДУЛЯ, а не useRef: ref живёт в конкретном
// экземпляре компонента, и при перемонтировании (или второй копии) появлялся
// новый ref — так два fireAll уходили одновременно и один и тот же запуск летел
// дважды (сервер потом отбивал по uploadKey). Модульный флаг общий для всех
// экземпляров, поэтому второй параллельный запуск не стартует вовсе.
let fireLock = false;

/** Ближайшая полночь по Москве (UTC+3, без перехода на летнее время) → ISO в UTC
 *  и удобная строка для показа. Запуск «с нулей»: реклама стартует в 00:00 МСК. */
function nextMoscowMidnight(): { iso: string; local: string } {
  const now = new Date();
  const msk = new Date(now.getTime() + 3 * 3600_000); // сдвиг к московскому «настенному» времени
  const y = msk.getUTCFullYear();
  const m = msk.getUTCMonth();
  const d = msk.getUTCDate();
  // Следующая полночь МСК = (сегодня+1) 00:00 по МСК; в UTC это на 3 часа раньше.
  // Date.UTC сам переносит день через край месяца/года.
  const iso = new Date(Date.UTC(y, m, d + 1, 0, 0, 0) - 3 * 3600_000).toISOString();
  const mskTarget = new Date(new Date(iso).getTime() + 3 * 3600_000);
  const p = (n: number) => String(n).padStart(2, '0');
  const local = `${mskTarget.getUTCFullYear()}-${p(mskTarget.getUTCMonth() + 1)}-${p(mskTarget.getUTCDate())}T00:00`;
  return { iso, local };
}
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
  structure: string; // 1-1-1 | 1-2-1 | 1-1-2 — как публикуем картинки
  files: File[];
};

const inp = 'h-9 w-full rounded-xl border border-line2 bg-sub px-3 text-[12.5px] text-soft outline-none focus:border-sage';
const box = 'rounded-[16px] border border-line bg-panel/40 px-4 py-4 sm:px-5';
const stepBadge = 'flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sage-t text-[12px] font-semibold text-sage';
// Метки статики/сториков — без ручного fb_pixel (он для видео-метода).
const DEFAULT_TAGS = 'ad_id={{ad.id}}&fbpx={{pixel}}&account_id={{account.id}}&campaign_id={{campaign.id}}';
const uid = () => Math.random().toString(36).slice(2, 9);

const modeLabel = (m: Mode) => (m === 'active' ? 'в актив' : m === 'scheduled' ? 'по расписанию' : m === 'midnight' ? 'с 00:00 МСК' : 'на паузе');

/**
 * Человеческая причина, почему кабинет не подтянулся. Ошибки токена/сессии
 * (протух, отозван, «сессия кончилась», код 190/1/100) сводим к «токен слетел».
 */
/** Ссылка валидна: http(s):// + домен с точкой, без пробелов. */
function isLinkValid(s: string): boolean {
  return /^https?:\/\/[^\s]+\.[^\s]+$/i.test(s.trim());
}

/**
 * В поле ссылки — только ссылка. При вставке достаём из буфера первый http(s)-URL;
 * если его нет, но вставили голый домен (example.com/path) — дописываем https://.
 * Иначе вставку не принимаем (вернём '' → вызывающий покажет подсказку).
 */
function extractUrl(text: string): string {
  const t = (text || '').trim();
  const m = t.match(/https?:\/\/[^\s<>"']+/i);
  if (m) return m[0];
  // Голый домен без схемы: буквы/цифры, хотя бы одна точка, опц. путь.
  if (/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9-]+)+(?:\/[^\s<>"']*)?$/i.test(t)) {
    return `https://${t}`;
  }
  return '';
}

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
export default function AutouploadForm({ cabinets, templates, languages = [], admin = false }: { cabinets: Cabinet[]; templates: Template[]; languages?: Language[]; admin?: boolean }) {
  const [pending, start] = useTransition();
  // Синхронный замок от дабл-клика: `pending` из useTransition обновляется
  // асинхронно, поэтому два быстрых клика оба проскакивали проверку и
  // запускали залив ДВАЖДЫ (в журнале дубль). Реф ставим до старта транзиции.
  const firing = useRef(false);

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
  // Что сейчас создаётся: `${accId}:pixel` / `${accId}:page` — для «создаю…».
  const [creating, setCreating] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [campaignName, setCampaignName] = useState('');
  const [link, setLink] = useState('');
  const [linkWarn, setLinkWarn] = useState('');
  const [budget, setBudget] = useState('');
  const [message, setMessage] = useState('');
  const [headline, setHeadline] = useState('');
  const [description, setDescription] = useState('');
  const [urlTags, setUrlTags] = useState(DEFAULT_TAGS);
  // fb_pixel вводится вручную каждый залив (из другого места) — не запоминаем.
  const [manualPixel, setManualPixel] = useState('');
  const [mode, setMode] = useState<Mode>('paused');
  const [startLocal, setStartLocal] = useState('');
  // Структура публикации картинок: по умолчанию 1-1-1 (на картинку своя
  // кампания+адсет). Надо иначе — человек переключит на 1-2-1 / 1-1-2.
  const [structure, setStructure] = useState('1-1-1');
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
  const [confirm, setConfirm] = useState(false);
  // Метод залива. Сейчас сторис/статика; видео с языками — отдельным методом позже.
  const [method, setMethod] = useState<'static' | 'video' | 'templates' | 'languages' | 'cards'>('static');
  const [qTpl, setQTpl] = useState('');
  const [qCab, setQCab] = useState('');
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
  // Поиск по кабинетам — по имени И по ID (externalId), чтобы можно было найти
  // кабинет, вбив кусок номера.
  const cabNeedle = qCab.trim().toLowerCase();
  const visibleCabs = cabNeedle
    ? ownerCabs.filter((c) => c.name.toLowerCase().includes(cabNeedle) || c.externalId.toLowerCase().includes(cabNeedle))
    : ownerCabs;

  const switchOwner = (o: string) => {
    if (o === owner) return;
    setOwner(o);
    setSelected(new Set());
    setQCab('');
  };

  const toggle = (id: string) =>
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  // «Выбрать/снять все» действует на то, что сейчас видно (с учётом поиска),
  // не трогая выбор скрытых фильтром кабинетов.
  const toggleAll = (on: boolean) =>
    setSelected((prev) => {
      const n = new Set(prev);
      for (const c of visibleCabs) { if (on) n.add(c.id); else n.delete(c.id); }
      return n;
    });

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
        // Сразу выбираем ПЕРВУЮ ГОДНУЮ ФП (разрешённую кабинетом) и первый
        // пиксель, чтобы поля не были пустыми. Негодные ФП не подставляем.
        if (!nP[id]) {
          const firstValid = (r.pages ?? []).find((p) => p.valid);
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
    setCreating(`${accId}:pixel`);
    start(async () => {
      try {
      const r = await makePixel(accId, newPixelByAcc[accId] ?? '');
      if (!r.ok) { setMsg({ ok: false, text: r.error ?? 'сбой создания пикселя' }); return; }
      setAssets((a) => ({ ...a, [accId]: { pages: a[accId]?.pages ?? [], pixels: r.pixels ?? [] } }));
      { const pick = r.createdId ?? (r.pixels?.length ? r.pixels[r.pixels.length - 1].id : ''); if (pick) setPixelByAcc((p) => ({ ...p, [accId]: pick })); }
      setNewPixelByAcc((n) => ({ ...n, [accId]: '' }));
      setMsg({ ok: true, text: 'Пиксель создан.' });
      } finally { setCreating(''); }
    });
  };

  const addPage = (accId: string) => {
    if (pending) return;
    const name = (newPageByAcc[accId] ?? '').trim();
    if (!name) { setMsg({ ok: false, text: 'Впиши имя новой страницы' }); return; }
    setCreating(`${accId}:page`);
    start(async () => {
      try {
      const r = await makePage(accId, name);
      if (!r.ok) { setMsg({ ok: false, text: r.error ?? 'сбой создания страницы' }); return; }
      setAssets((a) => ({ ...a, [accId]: { pages: r.pages ?? [], pixels: a[accId]?.pixels ?? [] } }));
      { const pick = r.createdId ?? (r.pages?.length ? r.pages[r.pages.length - 1].id : ''); if (pick) setPageByAcc((p) => ({ ...p, [accId]: pick })); }
      setNewPageByAcc((n) => ({ ...n, [accId]: '' }));
      setMsg({ ok: true, text: 'Страница создана.' });
      } finally { setCreating(''); }
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
    if (!list || list.length === 0) return;
    // ВАЖНО: снимаем файлы в массив СЕЙЧАС. Очистка input.value ниже опустошает
    // тот же живой FileList, и если читать его внутри setFiles (позже) — там уже
    // пусто, картинка «не выбирается».
    const picked = Array.from(list);
    if (fileInput.current) fileInput.current.value = '';
    setFiles((prev) => {
      const key = (f: File) => `${f.name}:${f.size}`;
      const have = new Set(prev.map(key));
      const add = picked.filter((f) => !have.has(key(f)));
      return [...prev, ...add].slice(0, 20);
    });
  };

  const resetConstructor = () => {
    setSelected(new Set());
    setTemplateId(''); setCampaignName(''); setLink(''); setBudget('');
    setMessage(''); setHeadline(''); setDescription(''); setUrlTags(DEFAULT_TAGS);
    setMode('paused'); setStartLocal(''); setFiles([]); setEditingId(null);
    setManualPixel(''); setStructure('1-1-1');
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
    // «С 00:00 МСК»: считаем ближайшую московскую полночь сами; «по расписанию» —
    // из введённой даты.
    const mid = mode === 'midnight' ? nextMoscowMidnight() : null;
    const startAt = mid ? mid.iso : mode === 'scheduled' && startLocal ? new Date(startLocal).toISOString() : '';
    const draft: Draft = {
      id: editingId ?? uid(),
      owner, cabinetIds: selectedList.map((c) => c.id), pick,
      templateId, campaignName: campaignName.trim(), link: link.trim(), budget: budget.trim(),
      message: message.trim(), headline: headline.trim(), description: description.trim(),
      urlTags: urlTags.trim(), manualPixel: manualPixel.trim(), mode, startAt, startLocal: mid ? mid.local : startLocal, structure, files,
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
    setMode(d.mode); setStartLocal(d.startLocal); setStructure(d.structure || '1-1-2'); setFiles(d.files); setEditingId(d.id);
    autoName.current = ''; // имя из черновика — руками, авто-подмена его не трогает
    setMsg(null);
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const removeDraft = (id: string) =>
    setQueue((q) => q.filter((d) => d.id !== id));

  const totalTargets = queue.reduce((n, d) => n + d.cabinetIds.length, 0);

  const fireAll = () => {
    if (fireLock || firing.current || pending || queue.length === 0) return;
    fireLock = true;
    firing.current = true;
    setMsg(null); setConfirm(false);
    start(async () => {
      try {
      // Как в видео-заливе: уходит в ФОН (startUpload), статусы — в журнале ниже
      // («Мои сторис-заливы» / общая стата). Никаких инлайн-плашек с кривыми
      // статусами — единый источник правды журнал, он же переживает обновление.
      let n = 0;
      for (const d of queue) {
        for (const cabId of d.cabinetIds) {
          const p = d.pick[cabId];
          const fd = new FormData();
          fd.set('accountId', cabId);
          // Ключ запуска: id черновика + кабинет. Один и тот же запуск,
          // случайно ушедший дважды, сервер отобьёт по этому ключу; разные
          // черновики (даже одинаковые по содержимому) — разные ключи, зальются.
          fd.set('uploadKey', `${d.id}:${cabId}`);
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
          fd.set('structure', d.structure || '1-1-2');
          // «С 00:00 МСК»: время старта считаем В МОМЕНТ ЗАПУСКА, а не при
          // добавлении в очередь — иначе «сегодняшняя» полночь к моменту запуска
          // уже в прошлом, и сервер отбивает «время в прошлом».
          const startAt = d.mode === 'midnight' ? nextMoscowMidnight().iso : d.startAt;
          if (startAt) fd.set('startAt', startAt);
          for (const f of d.files) fd.append('images', f);
          await startUpload(fd);
          n += 1;
        }
      }
      setQueue([]);
      setMsg({ ok: true, text: `Запущено в фоне: ${n}. Статусы — в списке ниже, можно уйти со страницы.` });
      } catch (e) {
        setMsg({ ok: false, text: `Не удалось запустить: ${(e as Error).message || 'ошибка сети'}. Очередь не тронута — попробуй ещё раз.` });
      } finally {
        firing.current = false;
        fireLock = false;
      }
    });
  };

  const onFireClick = () => {
    if (queue.length === 0) { setMsg({ ok: false, text: 'Очередь пуста — добавь хотя бы один залив' }); return; }
    if (!confirm) { setConfirm(true); return; }
    fireAll();
  };

  const anyAssets = selectedList.some((c) => assets[c.id]);

  return (
    <div className="flex flex-col gap-4">
      {/* Метод залива + отдельные вкладки настроек (шаблоны/языки) в этом же ряду.
          min-h-9 держит высоту ряда постоянной: поле поиска (h-9) появляется
          только у «Шаблонов», и без резерва ряд подпрыгивал при переключении. */}
      <div className="flex min-h-9 flex-wrap items-center gap-1.5">
        <button type="button" onClick={() => setMethod('static')} className={tab(method === 'static')}>Сторис / статика</button>
        <button type="button" onClick={() => setMethod('video')} className={tab(method === 'video')}>Видео + языки</button>
        <span className="mx-1 h-5 w-px bg-line2" />
        <button type="button" onClick={() => setMethod('templates')} className={tab(method === 'templates')}>Шаблоны гео <span className="opacity-70">· {templates.length}</span></button>
        <button type="button" onClick={() => setMethod('languages')} className={tab(method === 'languages')}>Языки <span className="opacity-70">· {languages.length}</span></button>
        <button type="button" onClick={() => setMethod('cards')} className={tab(method === 'cards')}>Карты</button>
        {method === 'templates' && templates.length > 0 ? (
          <input value={qTpl} onChange={(e) => setQTpl(e.target.value)} placeholder="Поиск по названию…" className="ml-auto h-9 w-[240px] rounded-full border border-line2 bg-sub px-4 text-[12.5px] text-soft outline-none focus:border-sage" />
        ) : null}
      </div>

      {method === 'templates' ? (
        <TemplateManager templates={templates} query={qTpl} />
      ) : method === 'cards' ? (
        <CardBinder cabinets={cabinets} />
      ) : method === 'languages' ? (
        <LanguagePack languages={languages} />
      ) : method === 'video' ? (
        <VideoUpload cabinets={cabinets} templates={templates} languages={languages} admin={admin} />
      ) : (
      <>
      {/* КОНСТРУКТОР. gap-4 — как в видео-заливе, чтобы при переключении вкладок
          интервалы между блоками не прыгали. */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold text-soft">{editingId ? 'Правка залива' : 'Новый залив'}</span>
          {editingId ? <button type="button" onClick={resetConstructor} className="text-[11.5px] text-mute transition hover:text-text">отменить правку</button> : null}
        </div>

        {/* 1 · Кабинеты + 2 · Креативы — в две колонки, равной высоты (stretch),
            чтобы правый бокс совпадал по размеру с видео-заливом. */}
        <div className="grid gap-4 lg:grid-cols-2">
        {/* Левый бокс не задаёт высоту сам (внутренний слой абсолютный на lg),
            поэтому строка грида равна ПРАВОМУ боксу, а не списку кабинетов —
            колонки одинаковые, а кабинеты листаются внутри. */}
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

          {/* Шапка поиска вынесена ИЗ прокрутки (не sticky) — иначе кабинеты
              просвечивали над ней в скруглённых углах. Скроллятся только строки. */}
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
          {/* Итог подтяжки — прямо под кнопкой, чтобы сбой был сразу заметен. */}
          {assetMsg ? (
            <div className="mt-2.5 rounded-[12px] border px-3 py-2 text-[12px]" style={assetMsg.ok ? { borderColor: '#3c4d33', background: '#1c241a', color: '#b4c68c' } : { borderColor: '#5a3a2a', background: '#2c1f1a', color: '#ce6e58' }}>
              {assetMsg.text}
            </div>
          ) : null}
         </div>
        </div>

        {/* 2 · Креативы — справа от кабинетов */}
        <div className={box}>
          <div className="flex items-center gap-2.5">
            <span className={stepBadge}>2</span>
            <span className="text-[13px] font-semibold">Креативы</span>
            {files.length > 0 ? <span className="ml-auto text-[12px] text-sage">{files.length} шт.</span> : null}
          </div>
          <p className="mt-1.5 text-[11px] text-mute">До 20 картинок. Авто-улучшения Меты отключаем.</p>
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

          {/* Как публикуем картинки — структура кампания/адсет/объявление. */}
          <div className="mt-3 border-t border-line pt-3">
            <div className="lab mb-1.5">Как публикуем картинки</div>
            <div className="flex flex-wrap gap-1.5">
              {(['1-1-1', '1-2-1', '1-1-2'] as const).map((val) => (
                <button key={val} type="button" onClick={() => setStructure(val)} className={`n rounded-full border px-4 py-1.5 text-[12px] font-medium transition ${structure === val ? 'border-sage bg-sage-t text-sage' : 'border-line2 bg-sub text-soft hover:border-sage'}`}>
                  {val}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[11px] text-dim">
              {structure === '1-1-2'
                ? 'Один бюджет на весь адсет — картинки делят его между собой.'
                : structure === '1-2-1'
                  ? `Бюджет задаётся на КАЖДЫЙ адсет: ${files.length || 'N'} картинок = ${files.length || 'N'}× расход.`
                  : `Каждая картинка — своя кампания со своим бюджетом: ${files.length || 'N'} картинок = ${files.length || 'N'}× расход.`}
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
                    {/* 4 колонки в строку: выбрать ФП · создать ФП · выбрать пиксель · создать пиксель. */}
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

        {/* Шаблон + объявление. Номер динамический: шаг «ФП/пиксель» появляется
            только после подтяжки, поэтому нумеруем по факту видимых шагов. */}
        <div className={box}>
          <div className="flex items-center gap-2.5">
            <span className={stepBadge}>{anyAssets ? 4 : 3}</span>
            <span className="text-[13px] font-semibold">Шаблон гео и объявление</span>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <TemplatePicker templates={templates} value={templateId} onPick={onPickTemplate} />
            {tpl ? <span className="rounded-full border border-line bg-sub px-3 py-1 text-[11.5px] text-mute">{tpl.countries}{tpl.excluded ? ` (−${tpl.excluded})` : ''} · {tpl.ageMin}-{tpl.ageMax} · {tpl.event} · {placementSummary(tpl.placements)}</span> : null}
            {/* Ссылка на объявление и бюджет — справа от поиска шаблона. */}
            <div className="ml-auto flex items-center gap-2">
              <input
                value={link}
                type="url"
                inputMode="url"
                spellCheck={false}
                autoComplete="off"
                onChange={(e) => { setLink(e.target.value.replace(/\s+/g, '')); setLinkWarn(''); }}
                onPaste={(e) => {
                  e.preventDefault();
                  const url = extractUrl(e.clipboardData.getData('text'));
                  if (url) { setLink(url); setLinkWarn(''); }
                  else setLinkWarn('Сюда можно вставить только ссылку (http(s)://…)');
                }}
                title={linkWarn || (link && !isLinkValid(link) ? 'Ссылка должна начинаться с http(s):// и без пробелов.' : undefined)}
                placeholder="Ссылка на объявление (https://…)"
                className={`h-9 w-[240px] max-w-full rounded-xl border bg-sub px-3 text-[12.5px] text-soft outline-none focus:border-sage ${link && !isLinkValid(link) ? 'border-rust focus:border-rust' : 'border-line2'}`}
              />
              <input value={budget} onChange={(e) => setBudget(e.target.value)} inputMode="decimal" placeholder="$/день" className="h-9 w-[90px] rounded-xl border border-line2 bg-sub px-3 text-[12.5px] text-soft outline-none focus:border-sage" />
            </div>
          </div>
          <div className="mt-2.5 grid gap-2">
            <input value={campaignName} onChange={(e) => setCampaignName(e.target.value)} placeholder="Название кампании (оно же у адсета и объявлений)" className={inp} />
            {(linkWarn || (link && !isLinkValid(link))) ? (
              <p className="text-[11px] text-rust">{linkWarn || 'Ссылка должна начинаться с http(s):// и без пробелов.'}</p>
            ) : null}
            <textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Текст объявления" rows={3} className="w-full rounded-xl border border-line2 bg-sub px-3 py-2 text-[12.5px] text-soft outline-none focus:border-sage" />
            <div className="grid gap-2 sm:grid-cols-2">
              <input value={headline} onChange={(e) => setHeadline(e.target.value)} placeholder="Заголовок (опц.)" className={inp} />
              <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Описание под ссылкой (опц.)" className={inp} />
            </div>
            {/* Ручной fb_pixel — та же аккуратная обводка, что и на видео (одно
                поле: сторис двух частей не требуют). */}
            {urlTags.includes('{{fbpixel}}') || urlTags.includes('{{fb_pixel}}') ? (
              <div className="rounded-xl border border-amber/40 bg-amber-t/40 px-3 py-2">
                <div className="mb-1 text-[11.5px] font-semibold text-amber">Метка fb_pixel в ссылке <span className="font-normal text-dim">· fbpx подставим автоматически (пиксель кабинета)</span></div>
                <input value={manualPixel} onChange={(e) => setManualPixel(e.target.value.replace(/\D/g, ''))} inputMode="numeric" placeholder="напр. 5645645435" className={`n ${inp}`} />
                <p className="mt-1 text-[11px] text-dim">Число (после «=») · подставится в метку <code className="text-mute">fb_pixel=…</code>. Вводишь при каждом заливе.</p>
              </div>
            ) : null}
            {/* Метки ссылки (пиксель и параметры) — в аккуратной обводке. */}
            <div className="rounded-xl border border-amber/40 bg-amber-t/40 px-3 py-2">
              <div className="mb-1 text-[11.5px] font-semibold text-amber">Метки ссылки (пиксель и параметры)</div>
              <input value={urlTags} onChange={(e) => setUrlTags(e.target.value)} className={`n ${inp}`} />
              <p className="mt-1 text-[11px] text-dim"><code className="text-mute">{'{{pixel}}'}</code> → пиксель кабинета; <code className="text-mute">{'{{ad.id}}'}</code>, <code className="text-mute">{'{{campaign.id}}'}</code>, <code className="text-mute">{'{{account.id}}'}</code> подставит ФБ.</p>
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
            {(['paused', 'active', 'midnight', 'scheduled'] as const).map((v) => (
              <button key={v} type="button" onClick={() => setMode(v)} className={`rounded-full border px-3.5 py-1.5 text-[12px] transition ${mode === v ? 'border-sage bg-sage-t text-sage' : 'border-line2 bg-sub text-soft hover:border-sage'}`}>
                {v === 'paused' ? 'На паузе' : v === 'active' ? 'Сразу в актив' : v === 'midnight' ? 'С 00:00 МСК' : 'По расписанию'}
              </button>
            ))}
            {mode === 'midnight' ? (
              <span className="text-[11.5px] text-mute">старт ночью в 00:00 по Москве — {nextMoscowMidnight().local.replace('T', ' ').slice(5)} (со свежими сутками)</span>
            ) : null}
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
          {/* Кнопка «в очередь» — отдельной строкой ниже кнопок режима. */}
          <div className="mt-3 flex items-center gap-2 border-t border-line pt-3">
            <button
              type="button"
              onClick={addToQueue}
              className="rounded-full border border-sage bg-sage-t px-5 py-2 text-[12.5px] font-medium text-sage transition hover:brightness-110"
            >
              {editingId ? 'Сохранить черновик' : '+ Добавить в очередь'}
            </button>
            {/* Предупреждение — только после клика (validateConstructor → msg). */}
            {msg ? <span className="text-[11.5px]" style={{ color: msg.ok ? '#b4c68c' : '#ce6e58' }}>{msg.text}</span> : null}
          </div>
        </div>
      </div>

      {/* ОЧЕРЕДЬ — показываем только когда в ней что-то есть. */}
      {queue.length > 0 ? (
      <div className="rounded-[16px] border border-line2 bg-panel/60 p-4 sm:p-5">
        <div className="flex items-center gap-2.5">
          <span className="text-[14px] font-semibold">Очередь заливов</span>
          <span className="text-[12px] text-mute">{queue.length} заливов · {totalTargets} кабинетов</span>
        </div>

        {queue.length > 0 ? (
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
                    {d.cabinetIds.length} каб. · {t?.name ?? 'шаблон?'} · {d.files.length} карт.{d.budget ? ` · $${d.budget}/д` : ''}{(d.mode === 'scheduled' || d.mode === 'midnight') && d.startLocal ? ` · старт ${d.startLocal.replace('T', ' ')}${d.mode === 'midnight' ? ' МСК' : ''}` : ''}
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}

        {queue.length > 0 ? (
          confirm ? (
            <div className="mt-3 flex flex-wrap items-center gap-2.5 rounded-[12px] border px-3 py-2.5 text-[12.5px]" style={{ borderColor: '#5a3a2a', background: '#241712' }}>
              <span className="text-soft">Запустить всю очередь?</span>
              <div className="ml-auto flex items-center gap-2">
                <button type="button" onClick={fireAll} disabled={pending} className="rounded-full border border-sage px-3.5 py-1.5 text-[12px] text-sage transition hover:bg-sage-t">Подтвердить</button>
                <button type="button" onClick={() => setConfirm(false)} className="rounded-full border border-line2 px-3.5 py-1.5 text-[12px] text-mute transition hover:text-text">Отмена</button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={onFireClick} disabled={pending} className={`mt-3 rounded-full border border-sage bg-sage-t px-6 py-2.5 text-[13px] font-semibold text-sage transition hover:brightness-110 ${pending ? 'opacity-50' : ''}`}>
              {pending ? 'Заливаю…' : `Залить всё${totalTargets ? ` (${totalTargets})` : ''}`}
            </button>
          )
        ) : null}

      </div>
      ) : null}

      {/* Журнал сторис/фото-заливов — отдельный от видео. */}
      {/* Баеру журнал — это его список выполненных заливов (loadRecentJobs
          отдаёт только его). Раскрыт по умолчанию, тянется из БД → переживает
          обновление страницы. Админу — общая стата (все свежие заливы). */}
      <JobsJournal
        kind="static"
        defaultExpanded={!admin}
        title={admin ? 'Журнал сторис-заливов · общая стата' : 'Мои сторис-заливы'}
      />
      </>
      )}
    </div>
  );
}
