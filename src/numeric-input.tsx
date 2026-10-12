import { useLayoutEffect, useRef, useState } from 'preact/hooks';

export function normalizeNumberText(text: string): string {
  return text.replace(/[０-９＋－．]/g, char => String.fromCharCode(char.charCodeAt(0) - 0xfee0));
}
export function parseNumberText(text: string): number {
  const normalized = normalizeNumberText(text).trim();
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(normalized)) return NaN;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : NaN;
}
const displayNumber = (value: number) => Number.isFinite(value) ? String(value) : '';

export function NumericInput({ value, disabled, describedBy, decimal = false, onValue }: {
  value: number; disabled?: boolean; describedBy?: string; decimal?: boolean; onValue(value: number): void;
}) {
  const [text, setText] = useState(() => displayNumber(value));
  const composing = useRef(false); const published = useRef(value);
  useLayoutEffect(() => {
    if (!Object.is(published.current, value)) {
      published.current = value;
      if (!composing.current) setText(displayNumber(value));
    }
  }, [value]);
  function publish(next: number) { published.current = next; onValue(next); }
  function commit(raw: string) {
    const normalized = normalizeNumberText(raw);
    setText(normalized); publish(parseNumberText(normalized));
  }
  return <input type="text" inputMode={decimal ? 'decimal' : 'numeric'} value={text} disabled={disabled}
    aria-describedby={describedBy} aria-invalid={Number.isNaN(value) || undefined}
    onCompositionStart={() => { composing.current = true; publish(NaN); }}
    onInput={event => {
      if (composing.current || event.isComposing) { composing.current = true; setText(event.currentTarget.value); publish(NaN); }
      else commit(event.currentTarget.value);
    }}
    onCompositionEnd={event => { composing.current = false; commit(event.currentTarget.value); }}
    onBlur={event => { composing.current = false; commit(event.currentTarget.value); }}/>
}
