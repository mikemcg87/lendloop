"use client";

import { api } from "@convex/_generated/api";
import type { RequestStatus } from "@convex/lib/domain";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { useState } from "react";
import { LoanSlip } from "@/components/dashboard/Requests";
import { Tabs } from "@/components/Tabs";
import {
  buttonSecondary,
  columnHead,
  ConfirmAction,
  ErrorText,
  ledgerRow,
  linkAction,
  meta,
  Note,
  STATUS_LABELS,
  Trusted,
  useRun,
} from "@/components/ui";

const PAGE_SIZE = 25;

const STATUS_FILTERS: RequestStatus[] = [
  "requested",
  "accepted",
  "overdue",
  "returned",
  "rejected",
  "cancelled",
];

function LoadMore({
  status,
  loadMore,
}: {
  status: string;
  loadMore: (n: number) => void;
}) {
  if (status !== "CanLoadMore") return null;
  return (
    <button onClick={() => loadMore(PAGE_SIZE)} className={buttonSecondary}>
      Turn the page
    </button>
  );
}

function Loans() {
  const [status, setStatus] = useState<RequestStatus | undefined>();
  const loans = usePaginatedQuery(
    api.admin.listLoans,
    { status },
    { initialNumItems: PAGE_SIZE },
  );

  return (
    <section className="space-y-4">
      <label className={`${meta} flex items-center gap-2`}>
        Status
        <select
          value={status ?? ""}
          onChange={(e) =>
            setStatus((e.target.value || undefined) as RequestStatus | undefined)
          }
          className="border border-ink/50 bg-slip px-2 py-1.5 font-mono text-[13px]"
        >
          <option value="">all</option>
          {STATUS_FILTERS.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </label>
      {loans.status === "LoadingFirstPage" ? (
        <Note>Fetching every loan…</Note>
      ) : loans.results.length === 0 ? (
        <Note>No loans match.</Note>
      ) : (
        <ul className="grid gap-4 lg:grid-cols-2">
          {loans.results.map((loan) => (
            <LoanSlip key={loan._id} loan={loan} viewer="admin" />
          ))}
        </ul>
      )}
      <LoadMore status={loans.status} loadMore={loans.loadMore} />
    </section>
  );
}

function Listings() {
  const tools = useQuery(api.tools.browse, {});
  const removeListing = useMutation(api.admin.removeListing);
  const { run, error, pending } = useRun();

  if (tools === undefined) return <Note>Fetching listings…</Note>;
  if (tools.length === 0) return <Note>No listings.</Note>;
  return (
    <section className="space-y-3">
      <ErrorText error={error} />
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className={columnHead}>Tool</th>
            <th className={columnHead}>Kept by</th>
            <th className={columnHead}>Where</th>
            <th className={columnHead}>
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {tools.map((tool) => (
            <tr key={tool._id} className={ledgerRow}>
              <td className="py-2.5 pr-4">
                {tool.name}
                <p className={meta}>{tool.category}</p>
              </td>
              <td className={`${meta} py-2.5 pr-4 align-top`}>
                {tool.owner?.name}
                {tool.owner?.trustedLender && <Trusted />}
              </td>
              <td className={`${meta} py-2.5 pr-4 align-top whitespace-nowrap`}>
                {tool.available ? "on the shelf" : "out on loan"}
              </td>
              <td className="py-2.5 text-right align-top whitespace-nowrap">
                <ConfirmAction
                  label="remove"
                  confirmLabel="yes, remove"
                  disabled={pending}
                  onConfirm={() =>
                    void run(() => removeListing({ toolId: tool._id }))
                  }
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function Users() {
  const users = usePaginatedQuery(
    api.admin.listUsers,
    {},
    { initialNumItems: PAGE_SIZE },
  );
  const setTrustedLender = useMutation(api.admin.setTrustedLender);
  const { run, error, pending } = useRun();

  if (users.status === "LoadingFirstPage") return <Note>Fetching members…</Note>;
  return (
    <section className="space-y-3">
      <ErrorText error={error} />
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className={columnHead}>Member</th>
            <th className={columnHead}>Standing</th>
            <th className={columnHead}>
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {users.results.map((user) => (
            <tr key={user._id} className={ledgerRow}>
              <td className="py-2.5 pr-4">
                {user.name}
                {user.email && <p className={`${meta} break-all`}>{user.email}</p>}
              </td>
              <td className={`${meta} py-2.5 pr-4 align-top whitespace-nowrap`}>
                {user.trustedLender ? "✓ trusted lender" : "member"}
              </td>
              <td className="py-2.5 text-right align-top whitespace-nowrap">
                <button
                  disabled={pending}
                  onClick={() =>
                    void run(() =>
                      setTrustedLender({
                        userId: user._id,
                        trusted: !user.trustedLender,
                      }),
                    )
                  }
                  className={linkAction}
                >
                  {user.trustedLender ? "withdraw trust" : "mark as trusted"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <LoadMore status={users.status} loadMore={users.loadMore} />
    </section>
  );
}

const TABS = [
  { id: "loans", label: "Every loan" },
  { id: "listings", label: "Listings" },
  { id: "users", label: "Members" },
] as const;

export function AdminPanel() {
  const me = useQuery(api.users.me);
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("loans");

  // Avoids firing admin queries that the backend would reject anyway.
  if (me?.role !== "admin") {
    return <Note>This part of the ledger is for LendLoop admins only.</Note>;
  }
  return (
    <>
      <h1 className="mb-5 text-3xl font-medium tracking-tight">
        Admin <i className="font-normal text-ink-soft">ledger</i>
      </h1>
      <Tabs tabs={TABS} active={tab} onChange={setTab} />
      <div className="pt-8">
        {tab === "loans" && <Loans />}
        {tab === "listings" && <Listings />}
        {tab === "users" && <Users />}
      </div>
    </>
  );
}
