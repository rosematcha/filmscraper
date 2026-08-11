import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * A setting as a word rather than a checkbox: on reads as plain text, off is
 * struck through and faint. `aria-pressed` carries the state for anyone not
 * looking at the strike-through.
 */
export function Word({
  on,
  label,
  hint,
  onToggle,
}: {
  readonly on: boolean;
  readonly label: string;
  readonly hint?: string | undefined;
  readonly onToggle: () => void;
}): React.JSX.Element {
  return (
    <div className="menu__row">
      <button type="button" className="word" aria-pressed={on} onClick={onToggle}>
        {label}
      </button>
      {hint !== undefined && hint !== '' && <span className="menu__hint">{hint}</span>}
    </div>
  );
}

/**
 * One group of settings behind a button that names its own count.
 *
 * The list is absolutely positioned so opening it never moves the table
 * underneath — the whole reason the options block stopped being inline.
 */
export function Menu({
  label,
  count,
  align = 'left',
  onAll,
  onNone,
  children,
}: {
  readonly label: string;
  readonly count?: string | undefined;
  readonly align?: 'left' | 'right';
  readonly onAll?: (() => void) | undefined;
  readonly onNone?: (() => void) | undefined;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);

  // A click anywhere else, or Escape, closes it. Without this the menu
  // outlives the interest in it.
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent): void => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <span className="menu" ref={root}>
      <button
        ref={trigger}
        type="button"
        className="menu__btn"
        aria-expanded={open}
        onClick={() => {
          setOpen((v) => !v);
        }}
      >
        {label}
        {count !== undefined && <span className="n"> {count}</span>}
      </button>
      {open && (
        <span className={`menu__list${align === 'right' ? ' menu__list--right' : ''}`}>
          {(onAll ?? onNone) && (
            <span className="menu__bulk">
              <span>{label}</span>
              <span>
                {onAll && (
                  <button type="button" onClick={onAll}>
                    all
                  </button>
                )}
                {onAll && onNone && ' · '}
                {onNone && (
                  <button type="button" onClick={onNone}>
                    none
                  </button>
                )}
              </span>
            </span>
          )}
          {children}
        </span>
      )}
    </span>
  );
}

/**
 * A number with our own −/+ either side.
 *
 * The platform spinner is the one piece of system chrome the settings line
 * could not style, so it is switched off in CSS and replaced here. Typing
 * still works, and so do the arrow keys the spinner was standing in for.
 */
export function Stepper({
  value,
  min,
  max,
  step = 5,
  onChange,
}: {
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step?: number;
  readonly onChange: (next: number) => void;
}): React.JSX.Element {
  const clamp = useCallback((next: number) => Math.min(max, Math.max(min, next)), [min, max]);
  return (
    <span className="stepper">
      <button
        type="button"
        onClick={() => {
          onChange(clamp(value - step));
        }}
        disabled={value <= min}
        aria-label={`fewer miles, ${String(clamp(value - step))}`}
      >
        −
      </button>
      <input
        type="number"
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={(e) => {
          const next = Number(e.target.value);
          if (Number.isFinite(next)) onChange(next);
        }}
        onBlur={(e) => {
          onChange(clamp(Number(e.target.value) || min));
        }}
        required
      />
      <button
        type="button"
        onClick={() => {
          onChange(clamp(value + step));
        }}
        disabled={value >= max}
        aria-label={`more miles, ${String(clamp(value + step))}`}
      >
        +
      </button>
    </span>
  );
}

/**
 * A table folded behind its own header line.
 *
 * Collapsed is the default: this week's listings are the product and
 * everything else is available in one click, with its count visible before
 * the click.
 */
export function Section({
  heading,
  count,
  open,
  onToggle,
  children,
}: {
  readonly heading: string;
  readonly count: number;
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section className="sect">
      <button type="button" className="sect__head" aria-expanded={open} onClick={onToggle}>
        <span className="sect__marker" aria-hidden="true">
          {open ? '−' : '+'}
        </span>
        <span>{heading}</span>
        <span className="sect__count">{count}</span>
      </button>
      {open && <div className="sect__body">{children}</div>}
    </section>
  );
}
