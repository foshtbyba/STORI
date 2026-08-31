import type { ReactNode } from 'react';
import Link from 'next/link';
import { usd } from '@/lib/money';

export function Panel({
  children,
  className = '',
  as: Tag = 'section',
}: {
  children: ReactNode;
  className?: string;
  as?: 'section' | 'div' | 'form' | 'article';
}) {
  return (
    <Tag
      className={`rounded-[26px] border border-line ${className}`}
      style={{ background: 'var(--color-panel-glass)' }}
    >
      {children}
    </Tag>
  );
}

export function Badge({ children, tint = 'bg-raise' }: { children: ReactNode; tint?: string }) {
  return (
    <span
      className={`flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full ${tint}`}
    >
      {children}
    </span>
  );
}

export function PanelHead({
  icon,
  tint,
  title,
  aside,
  right,
  iconHref,
  iconTitle,
}: {
  icon: ReactNode;
  tint?: string;
  title: string;
  aside?: ReactNode;
  right?: ReactNode;
  /** Если задан — иконка становится ссылкой (напр. «вернуть текущую неделю»). */
  iconHref?: string;
  iconTitle?: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-y-2.5">
      <div className="flex min-w-0 items-center gap-2.5 sm:gap-[13px]">
        {iconHref ? (
          <Link
            href={iconHref}
            prefetch={false}
            title={iconTitle}
            aria-label={iconTitle}
            className="rounded-[14px] outline-none ring-sage/40 transition hover:ring-2"
          >
            <Badge tint={tint}>{icon}</Badge>
          </Link>
        ) : (
          <Badge tint={tint}>{icon}</Badge>
        )}
        <h2 className="text-[17px] font-semibold tracking-[-0.015em]">{title}</h2>
        {aside ? (
          <>
            <span className="hidden h-5 w-px bg-line2 sm:block" />
            {aside}
          </>
        ) : null}
      </div>
      {right}
    </div>
  );
}

export function Pill({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-2 rounded-full px-3.5 py-2 ${className}`}>
      {children}
    </span>
  );
}

export function Sub({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-[18px] bg-sub ${className}`}>{children}</div>;
}

export function Field({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div>
      <div className="text-[11.5px] text-mute">{label}</div>
      <div className="n mt-1.5 text-[13.5px] font-semibold">{value}</div>
      {hint ? <div className="mt-1 text-[11px] text-dim">{hint}</div> : null}
    </div>
  );
}

export function Avatar({
  initials,
  color,
  size = 36,
  filled = false,
}: {
  initials: string;
  color: string;
  size?: number;
  filled?: boolean;
}) {
  return (
    <span
      className="n flex shrink-0 items-center justify-center rounded-full font-semibold leading-none"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.32,
        background: filled ? color : '#232324',
        color: filled ? '#141414' : color,
        border: filled ? 'none' : `1.5px solid ${color}`,
      }}
    >
      <span className="ink-mid">{initials}</span>
    </span>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-[18px] border border-dashed border-line px-6 py-10 text-center text-[13px] text-mute">
      {children}
    </div>
  );
}

/**
 * Цепочка расчёта живыми цифрами. Читается слева направо и заменяет собой
 * объяснение словами: видно и порядок действий, и что во что превращается.
 */
export function Formula({
  steps,
}: {
  steps: { value: string; label: string; op?: string; color?: string }[];
}) {
  return (
    <div className="flex flex-wrap items-stretch gap-2">
      {steps.map((step, i) => (
        <span key={step.label} className="flex items-stretch gap-2">
          {step.op ? (
            <span className="n flex items-center px-0.5 text-[18px] text-dim">{step.op}</span>
          ) : null}
          <span
            className={`flex min-w-[104px] flex-col justify-center rounded-xl px-3.5 py-2 ${
              i === steps.length - 1 ? 'bg-sage-t' : 'bg-sub'
            }`}
          >
            <span
              className="n text-[16px] font-semibold leading-none"
              style={step.color ? { color: step.color } : undefined}
            >
              {step.value}
            </span>
            <span className="mt-1.5 text-[10.5px] leading-none text-mute">{step.label}</span>
          </span>
        </span>
      ))}
    </div>
  );
}

/**
 * Крупная сумма: доллар мельче цифр, минус — впереди доллара.
 *
 * Раньше знак вырезали вместе с символом валюты и склеивали обратно, отчего
 * убыток печатался как «$−902». Минус стоит перед деньгами, а не внутри них.
 */
export function Big({
  cents,
  size = 76,
  className = '',
}: {
  cents: number;
  /** Размер цифр; доллар рисуется примерно вдвое мельче. */
  size?: number;
  className?: string;
}) {
  const text = usd(cents);
  const negative = text.startsWith('−');
  const digits = text.replace('−', '').replace('$', '');
  return (
    <div
      className={`font-bold leading-none tracking-[-0.035em] ${className}`}
      style={{ fontSize: size }}
    >
      <span className="text-mute" style={{ fontSize: Math.round(size * 0.55) }}>
        {negative ? '−' : ''}$
      </span>
      {digits}
    </div>
  );
}
