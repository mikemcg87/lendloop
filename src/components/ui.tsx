"use client";

import type { RequestStatus } from "@convex/lib/domain";
import { ConvexError } from "convex/values";
import { useState, type ReactNode } from "react";

const mono = "font-mono text-[13px]";

export const buttonPrimary = `${mono} border border-ink bg-ink px-3 py-2 text-paper hover:bg-ink-soft disabled:opacity-50`;
export const buttonSecondary = `${mono} border border-ink px-3 py-2 hover:bg-paper-deep disabled:opacity-50`;
// Text-style action, as written in the margin of a ledger.
export const linkAction = `${mono} underline underline-offset-4 hover:text-ink-soft disabled:opacity-50`;
export const linkDanger = `${mono} text-stamp underline underline-offset-4 hover:opacity-80 disabled:opacity-50`;
export const inputClass =
  "w-full border border-ink/50 bg-slip px-3 py-2 text-base focus:border-ink";
export const fieldLabel = `${mono} block text-ink-soft`;
export const columnHead = `${mono} border-b border-ink pb-1.5 text-left font-normal uppercase tracking-wider text-ink-soft`;
export const ledgerRow = "border-b border-dotted border-ink/40";
export const meta = `${mono} text-ink-soft`;

function errorMessage(error: unknown) {
  if (error instanceof ConvexError && typeof error.data === "string") {
    return error.data;
  }
  return "Something went wrong. Please try again.";
}

// Runs a mutation and surfaces the backend's ConvexError message.
export function useRun() {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  async function run(fn: () => Promise<unknown>) {
    setError(null);
    setPending(true);
    try {
      await fn();
      return true;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    } finally {
      setPending(false);
    }
  }
  return { run, error, pending };
}

export function ErrorText({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p role="alert" className={`${mono} text-stamp`}>
      {error}
    </p>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="mb-3 text-base italic text-ink-soft">{children}</h2>;
}

export function Note({ children }: { children: ReactNode }) {
  return <p className="italic text-ink-soft">{children}</p>;
}

export const STATUS_LABELS: Record<RequestStatus, string> = {
  requested: "awaiting reply",
  accepted: "on loan",
  overdue: "overdue",
  returned: "returned",
  rejected: "declined",
  cancelled: "withdrawn",
};

// "Overdue" gets the rubber stamp; every other status is a quiet label.
export function StatusMark({ status }: { status: RequestStatus }) {
  if (status === "overdue") {
    return (
      <span className="inline-block shrink-0 -rotate-[5deg] border-2 border-stamp px-2 py-0.5 font-mono text-[13px] font-medium uppercase tracking-[0.14em] text-stamp">
        Overdue
      </span>
    );
  }
  return <span className={`${meta} shrink-0`}>{STATUS_LABELS[status]}</span>;
}

export function Trusted() {
  return (
    <abbr title="Trusted Lender" className="no-underline">
      {"\u00a0"}✓<span className="sr-only"> Trusted Lender</span>
    </abbr>
  );
}

export function Select<T extends string>({
  value,
  onChange,
  options,
  allLabel,
}: {
  value: T | undefined;
  onChange: (value: T | undefined) => void;
  options: readonly T[];
  // When set, adds an "all" option that maps to undefined.
  allLabel?: string;
}) {
  return (
    <select
      value={value ?? ""}
      onChange={(e) => onChange((e.target.value || undefined) as T | undefined)}
      className={`${mono} border border-ink/50 bg-slip px-2 py-1.5`}
    >
      {allLabel && <option value="">{allLabel}</option>}
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  );
}

// Two-step confirmation in place, instead of a browser pop-up.
export function ConfirmAction({
  label,
  confirmLabel,
  disabled,
  onConfirm,
}: {
  label: string;
  confirmLabel: string;
  disabled?: boolean;
  onConfirm: () => void;
}) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <button
        disabled={disabled}
        onClick={() => setAsking(true)}
        className={linkDanger}
      >
        {label}
      </button>
    );
  }
  return (
    <span className={`${mono} inline-flex items-center gap-3`}>
      <button
        disabled={disabled}
        onClick={() => {
          setAsking(false);
          onConfirm();
        }}
        className={linkDanger}
      >
        {confirmLabel}
      </button>
      <button onClick={() => setAsking(false)} className={linkAction}>
        keep
      </button>
    </span>
  );
}

const DAY_MS = 86_400_000;
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["day", DAY_MS],
  ["hour", 3_600_000],
  ["minute", 60_000],
];

export function timeAgo(timestamp: number) {
  const elapsed = Date.now() - timestamp;
  const format = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  for (const [unit, ms] of UNITS) {
    if (elapsed >= ms) return format.format(-Math.floor(elapsed / ms), unit);
  }
  return "just now";
}

const dayFormat: Intl.DateTimeFormatOptions = {
  weekday: "short",
  day: "numeric",
  month: "short",
};

// "Sat 7 Nov" from a YYYY-MM-DD calendar date or a timestamp.
export function formatDay(value: string | number) {
  const date =
    typeof value === "string" ? new Date(`${value}T00:00:00`) : new Date(value);
  return date.toLocaleDateString("en-GB", dayFormat);
}

// Whole days past a YYYY-MM-DD due date (0 if not yet due).
export function daysPast(isoDate: string) {
  const due = new Date(`${isoDate}T00:00:00`).getTime();
  return Math.max(0, Math.floor((Date.now() - due) / DAY_MS));
}
