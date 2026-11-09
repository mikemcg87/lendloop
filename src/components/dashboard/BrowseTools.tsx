"use client";

import { api } from "@convex/_generated/api";
import { CATEGORIES, type Category } from "@convex/lib/domain";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Wrench } from "lucide-react";
import { useState } from "react";
import {
  AvailabilityBadge,
  buttonPrimary,
  buttonSecondary,
  ErrorText,
  inputClass,
  Select,
  TrustedBadge,
  useRun,
} from "../ui";

type Tool = FunctionReturnType<typeof api.tools.browse>[number];

export function ToolImage({ url, name }: { url: string | null; name: string }) {
  if (!url) {
    return (
      <div className="flex aspect-video items-center justify-center rounded-md bg-stone-100 text-stone-400">
        <Wrench className="size-8" aria-hidden />
      </div>
    );
  }
  return (
    // Convex storage URLs are served from the deployment's own host.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={name}
      className="aspect-video w-full rounded-md object-cover"
    />
  );
}

function RequestForm({ tool, onDone }: { tool: Tool; onDone: () => void }) {
  const createRequest = useMutation(api.requests.create);
  const { run, error, pending } = useRun();
  const today = new Date().toLocaleDateString("en-CA");
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);

  return (
    <form
      className="mt-3 space-y-3 border-t border-stone-200 pt-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const ok = await run(() =>
          createRequest({ toolId: tool._id, startDate, endDate }),
        );
        if (ok) onDone();
      }}
    >
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs font-medium text-stone-600">
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
            className={`mt-1 ${inputClass}`}
          />
        </label>
        <label className="text-xs font-medium text-stone-600">
          Until
          <input
            type="date"
            required
            min={startDate}
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className={`mt-1 ${inputClass}`}
          />
        </label>
      </div>
      <ErrorText error={error} />
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className={buttonPrimary}>
          Send request
        </button>
        <button type="button" onClick={onDone} className={buttonSecondary}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function ToolCard({ tool }: { tool: Tool }) {
  const [requesting, setRequesting] = useState(false);
  return (
    <li className="rounded-lg border border-stone-200 bg-white p-4">
      <ToolImage url={tool.imageUrl} name={tool.name} />
      <div className="mt-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium">{tool.name}</p>
          <p className="text-sm text-stone-500">
            {tool.category} · {tool.condition}
          </p>
        </div>
        <AvailabilityBadge available={tool.available} />
      </div>
      {tool.description && (
        <p className="mt-2 text-sm text-stone-700">{tool.description}</p>
      )}
      <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-stone-500">
        {tool.isMine ? "Your listing" : `Lent by ${tool.owner?.name ?? "a neighbour"}`}
        {tool.owner?.trustedLender && <TrustedBadge />}
      </p>
      {!tool.isMine &&
        (requesting ? (
          <RequestForm tool={tool} onDone={() => setRequesting(false)} />
        ) : (
          <button
            onClick={() => setRequesting(true)}
            className={`mt-3 ${buttonPrimary}`}
          >
            Request to borrow
          </button>
        ))}
    </li>
  );
}

export function BrowseTools() {
  const [category, setCategory] = useState<Category | undefined>();
  const tools = useQuery(api.tools.browse, { category });

  return (
    <section>
      <label className="flex items-center gap-2 text-sm text-stone-600">
        Category
        <Select
          value={category}
          onChange={setCategory}
          options={CATEGORIES}
          allLabel="All"
        />
      </label>
      {tools === undefined ? (
        <p className="mt-6 text-sm text-stone-500">Loading tools…</p>
      ) : tools.length === 0 ? (
        <p className="mt-6 text-sm text-stone-500">
          {category ? "No tools in this category yet." : "No tools listed yet."}
        </p>
      ) : (
        <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {tools.map((tool) => (
            <ToolCard key={tool._id} tool={tool} />
          ))}
        </ul>
      )}
    </section>
  );
}
