"use client";

import { api } from "@convex/_generated/api";
import type { RequestStatus } from "@convex/lib/domain";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { useState } from "react";
import { Tabs } from "@/components/Tabs";
import {
  ActivityList,
  AvailabilityBadge,
  buttonDanger,
  buttonSecondary,
  ErrorText,
  formatDate,
  StatusBadge,
  TrustedBadge,
  useRun,
} from "@/components/ui";

const PAGE_SIZE = 25;

const STATUS_FILTERS: { value: RequestStatus; label: string }[] = [
  { value: "requested", label: "Pending" },
  { value: "accepted", label: "On loan" },
  { value: "overdue", label: "Overdue" },
  { value: "returned", label: "Returned" },
  { value: "rejected", label: "Declined" },
  { value: "cancelled", label: "Cancelled" },
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
      Load more
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
      <label className="flex items-center gap-2 text-sm text-stone-600">
        Status
        <select
          value={status ?? ""}
          onChange={(e) =>
            setStatus((e.target.value || undefined) as RequestStatus | undefined)
          }
          className="rounded-md border border-stone-300 bg-white px-2 py-1.5 text-sm text-stone-900"
        >
          <option value="">All</option>
          {STATUS_FILTERS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      {loans.status === "LoadingFirstPage" ? (
        <p className="text-sm text-stone-500">Loading loans…</p>
      ) : loans.results.length === 0 ? (
        <p className="text-sm text-stone-500">No loans match.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-stone-200 text-xs uppercase tracking-wide text-stone-500">
              <tr>
                <th className="px-4 py-2">Tool</th>
                <th className="px-4 py-2">Owner</th>
                <th className="px-4 py-2">Borrower</th>
                <th className="px-4 py-2">Dates</th>
                <th className="px-4 py-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {loans.results.map((loan) => (
                <tr key={loan._id}>
                  <td className="px-4 py-2 font-medium">
                    {loan.tool?.name ?? "Removed tool"}
                  </td>
                  <td className="px-4 py-2">{loan.owner?.name}</td>
                  <td className="px-4 py-2">{loan.borrower?.name}</td>
                  <td className="whitespace-nowrap px-4 py-2">
                    {formatDate(loan.startDate)} to {formatDate(loan.endDate)}
                  </td>
                  <td className="px-4 py-2">
                    <StatusBadge status={loan.status} />
                    <ActivityList activity={loan.activity} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <LoadMore status={loans.status} loadMore={loans.loadMore} />
    </section>
  );
}

function Listings() {
  const tools = useQuery(api.tools.browse, {});
  const removeListing = useMutation(api.admin.removeListing);
  const { run, error, pending } = useRun();

  if (tools === undefined) {
    return <p className="text-sm text-stone-500">Loading listings…</p>;
  }
  if (tools.length === 0) {
    return <p className="text-sm text-stone-500">No listings.</p>;
  }
  return (
    <section className="space-y-3">
      <ErrorText error={error} />
      <ul className="divide-y divide-stone-100 rounded-lg border border-stone-200 bg-white">
        {tools.map((tool) => (
          <li
            key={tool._id}
            className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
          >
            <div className="min-w-0">
              <p className="truncate font-medium">{tool.name}</p>
              <p className="text-sm text-stone-500">
                {tool.category} · {tool.owner?.name}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <AvailabilityBadge available={tool.available} />
              <button
                disabled={pending}
                onClick={() => {
                  if (window.confirm(`Remove "${tool.name}" from LendLoop?`)) {
                    void run(() => removeListing({ toolId: tool._id }));
                  }
                }}
                className={buttonDanger}
              >
                Remove
              </button>
            </div>
          </li>
        ))}
      </ul>
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

  if (users.status === "LoadingFirstPage") {
    return <p className="text-sm text-stone-500">Loading users…</p>;
  }
  return (
    <section className="space-y-3">
      <ErrorText error={error} />
      <ul className="divide-y divide-stone-100 rounded-lg border border-stone-200 bg-white">
        {users.results.map((user) => (
          <li
            key={user._id}
            className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
          >
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2 font-medium">
                {user.name}
                {user.trustedLender && <TrustedBadge />}
              </p>
              <p className="truncate text-sm text-stone-500">{user.email}</p>
            </div>
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
              className={buttonSecondary}
            >
              {user.trustedLender ? "Revoke badge" : "Award Trusted Lender"}
            </button>
          </li>
        ))}
      </ul>
      <LoadMore status={users.status} loadMore={users.loadMore} />
    </section>
  );
}

const TABS = [
  { id: "loans", label: "All loans" },
  { id: "listings", label: "Listings" },
  { id: "users", label: "Users" },
] as const;

export default function AdminPage() {
  const me = useQuery(api.users.me);
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("loans");

  // Avoids firing admin queries that the backend would reject anyway.
  if (me?.role !== "admin") {
    return (
      <p className="text-sm text-stone-600">
        This area is for LendLoop admins only.
      </p>
    );
  }
  return (
    <>
      <h1 className="mb-4 text-2xl font-bold">Admin</h1>
      <Tabs tabs={TABS} active={tab} onChange={setTab} />
      <div className="pt-6">
        {tab === "loans" && <Loans />}
        {tab === "listings" && <Listings />}
        {tab === "users" && <Users />}
      </div>
    </>
  );
}
