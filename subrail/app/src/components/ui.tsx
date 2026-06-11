'use client';

import { useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';

/* Small shared UI primitives — presentation only, no business logic. */

export function Button({
  variant = 'primary',
  size,
  loading = false,
  children,
  disabled,
  className,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm';
  loading?: boolean;
}) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={['btn', `btn-${variant}`, size === 'sm' ? 'btn-sm' : '', className ?? ''].join(' ')}
    >
      {loading && <span className="spinner" aria-hidden />}
      {children}
    </button>
  );
}

export function Alert({ kind, children }: { kind: 'warn' | 'err' | 'info'; children: ReactNode }) {
  return (
    <div role={kind === 'err' ? 'alert' : 'status'} className={`alert alert-${kind}`}>
      {children}
    </div>
  );
}

export function Stepper({ labels, current }: { labels: string[]; current: number }) {
  return (
    <ol className="stepper" aria-label="Progress">
      {labels.map((label, i) => (
        <li
          key={label}
          data-n={i + 1}
          data-state={i < current ? 'done' : i === current ? 'current' : 'todo'}
          aria-current={i === current ? 'step' : undefined}
        >
          {label}
        </li>
      ))}
    </ol>
  );
}

export function AddressChip({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="addr">
      <span style={{ flex: 1 }}>{value}</span>
      <Button
        variant="secondary"
        size="sm"
        type="button"
        onClick={async () => {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  );
}

/** QR for the deposit address — lazy-loads the encoder, renders nothing on failure. */
export function QrCode({ value, size = 148 }: { value: string; size?: number }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    import('qrcode')
      .then((QR) => QR.toDataURL(value, { margin: 0, width: size * 2 }))
      .then((url) => alive && setSrc(url))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [value, size]);
  if (!src) return null;
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="qr" src={src} width={size} height={size} alt={`QR code for ${value}`} />;
}

export function Skeleton({ width = '100%', height = '1rem' }: { width?: string | number; height?: string | number }) {
  return <div className="skeleton" style={{ width, height }} aria-hidden />;
}
