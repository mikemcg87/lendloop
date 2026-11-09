"use client";

import { api } from "@convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import type { ReactNode } from "react";
import {
  buttonDanger,
  buttonPrimary,
  buttonSecondary,
  ErrorText,
  formatDate,
  StatusBadge,
  useRun,
} from "../ui";

type Request = FunctionReturnType<typeof api.requests.listMine>[number];

function RequestRow({
  request,
  counterparty,
  children,
}: {
  request: Request;
  counterparty: string;
  children?: ReactNode;
}) {
  return (
    <li className="rounded-lg border border-stone-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium">
            {request.tool?.name ?? "Removed tool"}
            {request.tool?.removed && (
              <span className="ml-2 text-xs font-normal text-stone-500">
                (listing removed)
              </span>
            )}
          </p>
          <p className="text-sm text-stone-500">
            {formatDate(request.startDate)} to {formatDate(request.endDate)} ·{" "}
            {counterparty}
          </p>
        </div>
        <StatusBadge status={request.status} />
      </div>
      {children}
    </li>
  );
}

function Group({
  title,
  empty,
  requests,
  render,
}: {
  title: string;
  empty: string;
  requests: Request[];
  render: (request: Request) => ReactNode;
}) {
  return (
    <div>
      <h3 className="text-sm font-semibold uppercase tracking-wide text-stone-500">
        {title}
      </h3>
      {requests.length === 0 ? (
        <p className="mt-2 text-sm text-stone-500">{empty}</p>
      ) : (
        <ul className="mt-2 space-y-2">{requests.map(render)}</ul>
      )}
    </div>
  );
}

function split(requests: Request[]) {
  return {
    active: requests.filter(
      (r) => r.status === "accepted" || r.status === "overdue",
    ),
    pending: requests.filter((r) => r.status === "requested"),
    past: requests.filter(
      (r) =>
        r.status === "returned" ||
        r.status === "rejected" ||
        r.status === "cancelled",
    ),
  };
}

function CancelButton({ request }: { request: Request }) {
  const cancel = useMutation(api.requests.cancel);
  const { run, error, pending } = useRun();
  return (
    <div className="mt-3 space-y-2">
      <button
        disabled={pending}
        onClick={() => void run(() => cancel({ requestId: request._id }))}
        className={buttonSecondary}
      >
        Cancel request
      </button>
      <ErrorText error={error} />
    </div>
  );
}

export function MyRequests() {
  const requests = useQuery(api.requests.listMine);
  if (requests === undefined) {
    return <p className="text-sm text-stone-500">Loading your requests…</p>;
  }
  const { active, pending, past } = split(requests);
  const from = (r: Request) => `from ${r.owner?.name ?? "a neighbour"}`;

  return (
    <section className="space-y-6">
      <Group
        title="Active"
        empty="You are not borrowing anything right now."
        requests={active}
        render={(r) => (
          <RequestRow key={r._id} request={r} counterparty={from(r)} />
        )}
      />
      <Group
        title="Pending"
        empty="No requests waiting on a reply."
        requests={pending}
        render={(r) => (
          <RequestRow key={r._id} request={r} counterparty={from(r)}>
            <CancelButton request={r} />
          </RequestRow>
        )}
      />
      <Group
        title="Past"
        empty="Nothing here yet."
        requests={past}
        render={(r) => (
          <RequestRow key={r._id} request={r} counterparty={from(r)} />
        )}
      />
    </section>
  );
}

function OwnerActions({ request }: { request: Request }) {
  const respond = useMutation(api.requests.respond);
  const markReturned = useMutation(api.requests.markReturned);
  const { run, error, pending } = useRun();
  const requestId = request._id;

  return (
    <div className="mt-3 space-y-2">
      <div className="flex gap-2">
        {request.status === "requested" ? (
          <>
            <button
              disabled={pending}
              onClick={() =>
                void run(() => respond({ requestId, decision: "accepted" }))
              }
              className={buttonPrimary}
            >
              Accept
            </button>
            <button
              disabled={pending}
              onClick={() =>
                void run(() => respond({ requestId, decision: "rejected" }))
              }
              className={buttonDanger}
            >
              Decline
            </button>
          </>
        ) : (
          <button
            disabled={pending}
            onClick={() => void run(() => markReturned({ requestId }))}
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
  const requests = useQuery(api.requests.listIncoming);
  if (requests === undefined) {
    return <p className="text-sm text-stone-500">Loading incoming requests…</p>;
  }
  const { active, pending, past } = split(requests);
  const by = (r: Request) => `requested by ${r.borrower?.name ?? "a neighbour"}`;

  return (
    <section className="space-y-6">
      <Group
        title="Needs your reply"
        empty="No one is waiting on you."
        requests={pending}
        render={(r) => (
          <RequestRow key={r._id} request={r} counterparty={by(r)}>
            <OwnerActions request={r} />
          </RequestRow>
        )}
      />
      <Group
        title="Out on loan"
        empty="None of your tools are out."
        requests={active}
        render={(r) => (
          <RequestRow key={r._id} request={r} counterparty={by(r)}>
            <OwnerActions request={r} />
          </RequestRow>
        )}
      />
      <Group
        title="Past"
        empty="Nothing here yet."
        requests={past}
        render={(r) => (
          <RequestRow key={r._id} request={r} counterparty={by(r)} />
        )}
      />
    </section>
  );
}
