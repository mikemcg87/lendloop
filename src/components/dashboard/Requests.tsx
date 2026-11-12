"use client";

import { api } from "@convex/_generated/api";
import type { RequestStatus } from "@convex/lib/domain";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useState, type ReactNode } from "react";
import {
  buttonPrimary,
  buttonSecondary,
  daysPast,
  ErrorText,
  fieldLabel,
  formatDay,
  inputClass,
  linkDanger,
  meta,
  Note,
  SectionTitle,
  StatusMark,
  timeAgo,
  useRun,
} from "../ui";

export type Loan = FunctionReturnType<typeof api.requests.listMine>[number];
type Viewer = "borrower" | "owner" | "admin";

type Entry = { text: string; when?: string; note?: string; automated?: boolean };

// The loan's history as dated ledger entries. Deliveries confirmed by n8n
// appear as a note under the step they announced, and as their own line
// for overdue reminders.
function history(loan: Loan, viewer: Viewer): Entry[] {
  const borrower =
    viewer === "borrower" ? "You" : (loan.borrower?.name ?? "A neighbour");
  const owner = viewer === "owner" ? "You" : (loan.owner?.name ?? "The owner");
  const notified = (status: RequestStatus) => {
    const event = loan.activity.find(
      (a) => a.kind === "notification_sent" && a.status === status,
    );
    if (event) return `notification sent ${timeAgo(event.at)}`;
    const failed = loan.activity.some(
      (a) => a.kind === "notification_failed" && a.status === status,
    );
    return failed ? "notification could not be sent" : undefined;
  };
  const decided = loan.decidedAt ? formatDay(loan.decidedAt) : undefined;

  const entries: Entry[] = [
    {
      text: `${borrower} asked to borrow it`,
      // No date when the loan was recorded after it began (seeded demo loans).
      when:
        new Date(loan._creationTime).toISOString().slice(0, 10) <= loan.startDate
          ? formatDay(loan._creationTime)
          : undefined,
      note: notified("requested"),
    },
  ];
  if (loan.status === "rejected") {
    entries.push({ text: `${owner} said no`, when: decided, note: notified("rejected") });
  } else if (loan.status === "cancelled") {
    entries.push({
      text: `${borrower} withdrew the request`,
      when: decided,
      note: notified("cancelled"),
    });
  } else if (loan.status !== "requested") {
    entries.push({ text: `${owner} said yes`, when: decided, note: notified("accepted") });
    entries.push({ text: "Due back", when: formatDay(loan.endDate) });
    for (const event of [...loan.activity].reverse()) {
      if (event.kind === "reminder_sent") {
        entries.push({
          text: `Reminder sent to ${viewer === "borrower" ? "you" : borrower}`,
          when: timeAgo(event.at),
          automated: true,
        });
      }
    }
    if (loan.status === "returned" && loan.returnedAt) {
      entries.push({
        text: "Returned",
        when: formatDay(loan.returnedAt),
        note: notified("returned"),
      });
      if (loan.returnNote) {
        entries.push({ text: `${owner} noted: “${loan.returnNote}”` });
      }
    }
  }
  return entries;
}

export function LoanSlip({
  loan,
  viewer,
  children,
}: {
  loan: Loan;
  viewer: Viewer;
  children?: ReactNode;
}) {
  // An accepted loan past its end date reads as overdue straight away, even
  // before the daily n8n run has marked it and sent the reminder.
  const late =
    loan.status === "overdue" || loan.status === "accepted"
      ? daysPast(loan.endDate)
      : 0;
  const status = late > 0 ? "overdue" : loan.status;
  const party =
    viewer === "borrower"
      ? `from ${loan.owner?.name ?? "a neighbour"}`
      : viewer === "owner"
        ? `to ${loan.borrower?.name ?? "a neighbour"}`
        : `${loan.owner?.name ?? "?"} → ${loan.borrower?.name ?? "?"}`;

  return (
    <li className="border border-ink bg-slip p-4 sm:p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-xl font-medium">
            {loan.tool?.name ?? "A removed tool"}
          </h3>
          <p className={meta}>
            {party} · {formatDay(loan.startDate)}
            {loan.endDate !== loan.startDate &&
              ` to ${formatDay(loan.endDate)}`}
            {loan.tool?.removed && " · listing removed"}
          </p>
          {late > 0 && (
            <p className="mt-1 font-mono text-[13px] text-stamp">
              {late} {late === 1 ? "day" : "days"} late
            </p>
          )}
        </div>
        <StatusMark status={status} />
      </div>
      <ol className="mt-4 border-t border-ink/20">
        {history(loan, viewer).map((entry, index) => (
          <li
            key={index}
            className="flex items-baseline justify-between gap-4 border-b border-dotted border-ink/40 py-1.5 text-[15px]"
          >
            <span className={entry.automated ? "italic" : ""}>
              {entry.text}
              {entry.note && (
                <span className="ml-2 italic text-ink-soft">· {entry.note}</span>
              )}
            </span>
            {entry.when && (
              <span className="font-mono text-xs whitespace-nowrap text-ink-soft">
                {entry.when}
              </span>
            )}
          </li>
        ))}
      </ol>
      {children}
    </li>
  );
}

function Group({
  title,
  empty,
  loans,
  render,
}: {
  title: string;
  empty: string;
  loans: Loan[];
  render: (loan: Loan) => ReactNode;
}) {
  return (
    <div>
      <SectionTitle>{title}</SectionTitle>
      {loans.length === 0 ? (
        <Note>{empty}</Note>
      ) : (
        <ul className="grid gap-4 lg:grid-cols-2">{loans.map(render)}</ul>
      )}
    </div>
  );
}

function split(loans: Loan[]) {
  return {
    active: loans.filter(
      (l) => l.status === "accepted" || l.status === "overdue",
    ),
    pending: loans.filter((l) => l.status === "requested"),
    past: loans.filter(
      (l) =>
        l.status === "returned" ||
        l.status === "rejected" ||
        l.status === "cancelled",
    ),
  };
}

function WithdrawButton({ loan }: { loan: Loan }) {
  const cancel = useMutation(api.requests.cancel);
  const { run, error, pending } = useRun();
  return (
    <div className="mt-4 space-y-2">
      <button
        disabled={pending}
        onClick={() => void run(() => cancel({ requestId: loan._id }))}
        className={linkDanger}
      >
        withdraw request
      </button>
      <ErrorText error={error} />
    </div>
  );
}

export function MyRequests() {
  const loans = useQuery(api.requests.listMine);
  if (loans === undefined) return <Note>Fetching your slips…</Note>;
  const { active, pending, past } = split(loans);

  return (
    <section className="space-y-8">
      <Group
        title="With you now"
        empty="You have nothing out on loan."
        loans={active}
        render={(l) => <LoanSlip key={l._id} loan={l} viewer="borrower" />}
      />
      <Group
        title="Waiting on a neighbour"
        empty="No requests waiting on a reply."
        loans={pending}
        render={(l) => (
          <LoanSlip key={l._id} loan={l} viewer="borrower">
            <WithdrawButton loan={l} />
          </LoanSlip>
        )}
      />
      <Group
        title="Closed"
        empty="Nothing in the back pages yet."
        loans={past}
        render={(l) => <LoanSlip key={l._id} loan={l} viewer="borrower" />}
      />
    </section>
  );
}

function OwnerActions({ loan }: { loan: Loan }) {
  const respond = useMutation(api.requests.respond);
  const markReturned = useMutation(api.requests.markReturned);
  const { run, error, pending } = useRun();
  const [note, setNote] = useState("");
  const requestId = loan._id;

  return (
    <div className="mt-4 space-y-2">
      {loan.status !== "requested" && (
        <label className={`${fieldLabel} block`}>
          Anything damaged or missing? (optional)
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={300}
            placeholder="Came back fine"
            className={`mt-1 ${inputClass}`}
          />
        </label>
      )}
      <div className="flex gap-2">
        {loan.status === "requested" ? (
          <>
            <button
              disabled={pending}
              onClick={() =>
                void run(() => respond({ requestId, decision: "accepted" }))
              }
              className={buttonPrimary}
            >
              Lend it
            </button>
            <button
              disabled={pending}
              onClick={() =>
                void run(() => respond({ requestId, decision: "rejected" }))
              }
              className={buttonSecondary}
            >
              Not this time
            </button>
          </>
        ) : (
          <button
            disabled={pending}
            onClick={() =>
              void run(() =>
                markReturned({ requestId, note: note.trim() || undefined }),
              )
            }
            className={buttonPrimary}
          >
            Mark as returned
          </button>
        )}
      </div>
      <ErrorText error={error} />
    </div>
  );
}

export function IncomingRequests() {
  const loans = useQuery(api.requests.listIncoming);
  if (loans === undefined) return <Note>Fetching requests for your tools…</Note>;
  const { active, pending, past } = split(loans);

  return (
    <section className="space-y-8">
      <Group
        title="Needs your answer"
        empty="Nobody is waiting on you."
        loans={pending}
        render={(l) => (
          <LoanSlip key={l._id} loan={l} viewer="owner">
            <OwnerActions loan={l} />
          </LoanSlip>
        )}
      />
      <Group
        title="Out with a neighbour"
        empty="All your tools are at home."
        loans={active}
        render={(l) => (
          <LoanSlip key={l._id} loan={l} viewer="owner">
            <OwnerActions loan={l} />
          </LoanSlip>
        )}
      />
      <Group
        title="Closed"
        empty="Nothing in the back pages yet."
        loans={past}
        render={(l) => <LoanSlip key={l._id} loan={l} viewer="owner" />}
      />
    </section>
  );
}
