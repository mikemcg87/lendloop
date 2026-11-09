"use client";

import type { AutomationKind, RequestStatus } from "@convex/lib/domain";
import { ConvexError } from "convex/values";
import { BadgeCheck, Zap } from "lucide-react";
import { useState } from "react";

export const buttonPrimary =
  "rounded-md bg-emerald-700 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50";
export const buttonSecondary =
  "rounded-md border border-stone-300 bg-white px-3 py-2 text-sm font-medium hover:bg-stone-100 disabled:opacity-50";
export const buttonDanger =
  "rounded-md border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50";
export const inputClass =
  "w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm";

export function errorMessage(error: unknown) {
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
    <p role="alert" className="text-sm text-red-700">
      {error}
    </p>
  );
}

const STATUS_STYLES: Record<RequestStatus, { label: string; className: string }> = {
  requested: { label: "Pending", className: "bg-sky-100 text-sky-800" },
  accepted: { label: "On loan", className: "bg-emerald-100 text-emerald-800" },
  overdue: { label: "Overdue", className: "bg-red-100 text-red-800" },
  returned: { label: "Returned", className: "bg-stone-200 text-stone-700" },
  rejected: { label: "Declined", className: "bg-stone-200 text-stone-700" },
  cancelled: { label: "Cancelled", className: "bg-stone-200 text-stone-700" },
};

export function StatusBadge({ status }: { status: RequestStatus }) {
  const { label, className } = STATUS_STYLES[status];
  return (
    <span
      className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${className}`}
    >
      {label}
    </span>
  );
}

export function AvailabilityBadge({ available }: { available: boolean }) {
  return (
    <span
      className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${
        available
          ? "bg-emerald-100 text-emerald-800"
          : "bg-amber-100 text-amber-800"
      }`}
    >
      {available ? "Available" : "On loan"}
    </span>
  );
}

export function TrustedBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-800">
      <BadgeCheck className="size-3.5" aria-hidden />
      Trusted Lender
    </span>
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
      className="rounded-md border border-stone-300 bg-white px-2 py-1.5 text-sm text-stone-900"
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

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
];

export function timeAgo(timestamp: number) {
  const elapsed = Date.now() - timestamp;
  const format = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  for (const [unit, ms] of UNITS) {
    if (elapsed >= ms) return format.format(-Math.floor(elapsed / ms), unit);
  }
  return "just now";
}

const NOTIFICATION_LABELS: Record<RequestStatus, string> = {
  requested: "New request",
  accepted: "Acceptance",
  rejected: "Decline",
  cancelled: "Cancellation",
  returned: "Return",
  overdue: "Overdue",
};

type Activity = { kind: AutomationKind; status?: RequestStatus; at: number };

// Deliveries n8n has confirmed for a loan, e.g. "Reminder sent 2 days ago".
export function ActivityList({ activity }: { activity: Activity[] }) {
  if (activity.length === 0) return null;
  return (
    <ul className="mt-2 space-y-0.5 text-xs text-stone-500">
      {activity.map((event) => (
        <li key={`${event.kind}-${event.at}`} className="flex items-center gap-1">
          <Zap className="size-3 shrink-0" aria-hidden />
          {event.kind === "reminder_sent"
            ? "Overdue reminder sent"
            : `${event.status ? NOTIFICATION_LABELS[event.status] : "Status"} notification sent`}{" "}
          {timeAgo(event.at)}
        </li>
      ))}
    </ul>
  );
}

export function formatDate(isoDate: string) {
  return new Date(`${isoDate}T00:00:00`).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
