/**
 * Заглушка на время, пока страница считается на сервере.
 *
 * Без неё нажатие на пункт меню какое-то время не даёт вообще ничего: браузер
 * молча ждёт ответ, и это читается как «сайт подвис». Скелет появляется сразу
 * и держит форму будущей страницы, так что переход выглядит мгновенным даже
 * когда сервер отвечает не сразу.
 */
function Bar({ w = 'w-full', h = 'h-4' }: { w?: string; h?: string }) {
  return <span className={`block ${w} ${h} animate-pulse rounded-full bg-sub`} />;
}

export default function Loading() {
  return (
    <div className="flex flex-col gap-2.5 sm:gap-3.5">
      <section
        className="rounded-[26px] border border-line p-4 sm:p-6"
        style={{ background: 'var(--color-panel-glass)' }}
      >
        <div className="flex items-center gap-3">
          <span className="h-[42px] w-[42px] shrink-0 animate-pulse rounded-full bg-sub" />
          <Bar w="w-40" h="h-5" />
        </div>
        <div className="mt-6 flex flex-col gap-3.5">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="flex items-center gap-4">
              <span className="h-7 w-7 shrink-0 animate-pulse rounded-full bg-sub" />
              <Bar w="w-1/3" />
              <span className="flex-1" />
              <Bar w="w-20" />
            </div>
          ))}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-[1.6fr_1fr] lg:gap-3.5">
        {[0, 1].map((i) => (
          <section
            key={i}
            className="rounded-[26px] border border-line p-4 sm:p-6"
            style={{ background: 'var(--color-panel-glass)' }}
          >
            <Bar w="w-32" h="h-5" />
            <div className="mt-5 flex flex-col gap-3">
              <Bar />
              <Bar w="w-4/5" />
              <Bar w="w-2/3" />
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
