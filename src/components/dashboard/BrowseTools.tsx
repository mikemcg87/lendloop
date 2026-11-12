"use client";

import { api } from "@convex/_generated/api";
import { CATEGORIES, type Category } from "@convex/lib/domain";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useState } from "react";
import {
  buttonPrimary,
  buttonSecondary,
  columnHead,
  ErrorText,
  fieldLabel,
  inputClass,
  ledgerRow,
  linkAction,
  meta,
  Note,
  Select,
  Trusted,
  useRun,
} from "../ui";

type Tool = FunctionReturnType<typeof api.tools.browse>[number];

const AVAILABILITY = { "On the shelf": "available", "Out on loan": "on_loan" } as const;
type Availability = keyof typeof AVAILABILITY;
const AVAILABILITIES = Object.keys(AVAILABILITY) as Availability[];

export function ToolThumb({ url, name }: { url: string | null; name: string }) {
  if (!url) return null;
  return (
    // Convex storage URLs are served from the deployment's own host.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={name}
      className="size-20 shrink-0 border border-ink/30 object-cover saturate-[0.8]"
    />
  );
}

function RequestForm({
  tool,
  onDone,
  onSent,
}: {
  tool: Tool;
  onDone: () => void;
  onSent: () => void;
}) {
  const createRequest = useMutation(api.requests.create);
  const { run, error, pending } = useRun();
  const today = new Date().toLocaleDateString("en-CA");
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);

  return (
    <form
      className="space-y-3 border border-ink bg-slip p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const ok = await run(() =>
          createRequest({ toolId: tool._id, startDate, endDate }),
        );
        if (ok) {
          onSent();
          onDone();
        }
      }}
    >
      <p className="italic">
        Put your name down for the {tool.name.toLowerCase()}.
      </p>
      <div className="grid max-w-sm grid-cols-2 gap-3">
        <label className={fieldLabel}>
          From
          <input
            type="date"
            required
            min={today}
            value={startDate}
            onChange={(e) => {
              setStartDate(e.target.value);
              if (e.target.value > endDate) setEndDate(e.target.value);
            }}
            className={`mt-1 font-mono text-sm ${inputClass}`}
          />
        </label>
        <label className={fieldLabel}>
          Back by
          <input
            type="date"
            required
            min={startDate}
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className={`mt-1 font-mono text-sm ${inputClass}`}
          />
        </label>
      </div>
      <ErrorText error={error} />
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className={buttonPrimary}>
          Send request
        </button>
        <button type="button" onClick={onDone} className={buttonSecondary}>
          Never mind
        </button>
      </div>
    </form>
  );
}

function ToolRow({ tool }: { tool: Tool }) {
  const [requesting, setRequesting] = useState(false);
  const [sent, setSent] = useState(false);
  const owner = tool.owner?.name ?? "a neighbour";
  return (
    <>
      <tr className={requesting || sent ? "" : ledgerRow}>
        <td className="py-3 pr-4">
          <div className="flex items-start gap-3">
            <ToolThumb url={tool.imageUrl} name={tool.name} />
            <div className="min-w-0">
              <span
                className={
                  tool.available ? "" : "text-ink-soft line-through decoration-1"
                }
              >
                {tool.name}
              </span>
              <p className={meta}>
                {tool.category} · {tool.condition.toLowerCase()}
                <span className="sm:hidden">
                  {" "}
                  · {tool.isMine ? "yours" : owner}
                  {tool.owner?.trustedLender && <Trusted />}
                  {!tool.available && " · out on loan"}
                </span>
              </p>
              {tool.description && (
                <p className="mt-1 text-[15px] text-ink-soft">
                  {tool.description}
                </p>
              )}
            </div>
          </div>
        </td>
        <td className={`${meta} hidden py-3 pr-4 align-top sm:table-cell`}>
          {tool.isMine ? "you" : owner}
          {tool.owner?.trustedLender && <Trusted />}
        </td>
        <td className="py-3 text-right align-top whitespace-nowrap">
          {tool.isMine ? (
            <span className={meta}>your listing</span>
          ) : (
            <>
              {!tool.available && (
                <span className={`${meta} mr-3 hidden sm:inline`}>out on loan</span>
              )}
              <button
                onClick={() => {
                  setSent(false);
                  setRequesting(true);
                }}
                aria-expanded={requesting}
                className={linkAction}
              >
                {tool.available ? "borrow →" : "ask for later →"}
              </button>
            </>
          )}
        </td>
      </tr>
      {requesting && (
        <tr className={ledgerRow}>
          <td colSpan={3} className="pb-4">
            <RequestForm
              tool={tool}
              onDone={() => setRequesting(false)}
              onSent={() => setSent(true)}
            />
          </td>
        </tr>
      )}
      {sent && !requesting && (
        <tr className={ledgerRow}>
          <td colSpan={3} role="status" className={`${meta} pb-3`}>
            Request sent to {owner}. It is under My requests, where you can
            withdraw it.
          </td>
        </tr>
      )}
    </>
  );
}

export function BrowseTools() {
  const [category, setCategory] = useState<Category | undefined>();
  const [availability, setAvailability] = useState<Availability | undefined>();
  const tools = useQuery(api.tools.browse, {
    category,
    availability: availability && AVAILABILITY[availability],
  });

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-base italic text-ink-soft">Everything on the board</h2>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          <label className={`${meta} flex items-center gap-2`}>
            Category
            <Select
              value={category}
              onChange={setCategory}
              options={CATEGORIES}
              allLabel="All"
            />
          </label>
          <label className={`${meta} flex items-center gap-2`}>
            Availability
            <Select
              value={availability}
              onChange={setAvailability}
              options={AVAILABILITIES}
              allLabel="All"
            />
          </label>
        </div>
      </div>
      {tools === undefined ? (
        <Note>Fetching the board…</Note>
      ) : tools.length === 0 ? (
        <Note>
          {category || availability
            ? "Nothing on the board matches those filters."
            : "The board is empty. List the first tool under My listings."}
        </Note>
      ) : (
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className={columnHead}>Tool</th>
              <th className={`${columnHead} hidden sm:table-cell`}>Kept by</th>
              <th className={columnHead}>
                <span className="sr-only">Borrow</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {tools.map((tool) => (
              <ToolRow key={tool._id} tool={tool} />
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
