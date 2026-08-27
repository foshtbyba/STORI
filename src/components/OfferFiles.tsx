'use client';

import { useRef, useState } from 'react';

export type OfferFileRow = { id: string; name: string; size: number; mime: string };

const kb = (n: number) => (n < 1024 * 1024 ? `${Math.round(n / 1024)} КБ` : `${(n / 1024 / 1024).toFixed(1)} МБ`);

/**
 * Превью оффера и фото под отзывы.
 *
 * Ссылок на эти картинки нет — их приносят файлами, поэтому и грузим файлами,
 * а обратно отдаём скачиванием. Отзывы держим свёрнутыми: нужны редко, но
 * когда нужны — выгружаются все разом.
 */
export default function OfferFiles({
  offerId,
  preview,
  reviews,
  upload,
  remove,
}: {
  offerId: string;
  preview: OfferFileRow | null;
  reviews: OfferFileRow[];
  upload: (formData: FormData) => void;
  remove: (formData: FormData) => void;
}) {
  const [open, setOpen] = useState(false);
  const previewForm = useRef<HTMLFormElement>(null);
  const reviewForm = useRef<HTMLFormElement>(null);

  return (
    <div className="mt-3 border-t border-line pt-3">
      {/* ── Превью ─────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2">
        <form ref={previewForm} action={upload} className="contents">
          <input type="hidden" name="offerId" value={offerId} />
          <input type="hidden" name="kind" value="PREVIEW" />
          <label className="flex-1 cursor-pointer rounded-full border border-line px-4 py-2 text-center text-[12px] text-mute transition hover:border-line2 hover:text-soft">
            {preview ? 'Заменить превью' : 'Загрузить превью'}
            <input
              type="file"
              name="files"
              accept="image/*,application/pdf"
              className="hidden"
              onChange={() => previewForm.current?.requestSubmit()}
            />
          </label>
        </form>
        {preview ? (
          <>
            <a
              href={`/api/offer-file/${preview.id}?dl=1`}
              className="shrink-0 rounded-full border border-line px-3.5 py-2 text-[12px] text-mute transition hover:border-sage hover:text-sage"
            >
              Скачать
            </a>
            <form action={remove}>
              <input type="hidden" name="fileId" value={preview.id} />
              <button type="submit" className="px-1 text-[12px] text-dim transition hover:text-rust">
                ✕
              </button>
            </form>
          </>
        ) : null}
      </div>

      {/* ── Отзывы ─────────────────────────────────────────────────── */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="mt-2 flex w-full items-center justify-between rounded-lg px-1 py-1.5 text-[11.5px] text-dim transition hover:text-mute"
      >
        <span>Фото для отзывов{reviews.length ? ` · ${reviews.length}` : ''}</span>
        <span className={`transition-transform ${open ? 'rotate-90' : ''}`}>›</span>
      </button>

      {open ? (
        <div className="mt-1">
          {reviews.length ? (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {reviews.map((r) => (
                <span key={r.id} className="flex items-center gap-1.5 rounded-lg bg-sub p-1 pr-2">
                  {r.mime.startsWith('image/') ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`/api/offer-file/${r.id}`}
                      alt=""
                      className="h-9 w-9 rounded-md object-cover"
                    />
                  ) : null}
                  <a
                    href={`/api/offer-file/${r.id}?dl=1`}
                    className="max-w-[110px] truncate text-[10.5px] text-mute transition hover:text-sage"
                    title={`${r.name} · ${kb(r.size)}`}
                  >
                    {r.name}
                  </a>
                  <form action={remove}>
                    <input type="hidden" name="fileId" value={r.id} />
                    <button type="submit" className="text-[10px] text-dim transition hover:text-rust">
                      ✕
                    </button>
                  </form>
                </span>
              ))}
            </div>
          ) : (
            <p className="mb-2 px-1 text-[11px] text-dim">Пока пусто — банка в руке и всё такое.</p>
          )}

          <form ref={reviewForm} action={upload}>
            <input type="hidden" name="offerId" value={offerId} />
            <input type="hidden" name="kind" value="REVIEW" />
            <label className="block cursor-pointer rounded-full border border-dashed border-line px-4 py-2 text-center text-[11.5px] text-dim transition hover:border-line2 hover:text-mute">
              Добавить фото
              <input
                type="file"
                name="files"
                accept="image/*"
                multiple
                className="hidden"
                onChange={() => reviewForm.current?.requestSubmit()}
              />
            </label>
          </form>
        </div>
      ) : null}
    </div>
  );
}
