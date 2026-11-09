"use client";

import { api } from "@convex/_generated/api";
import type { Category } from "@convex/lib/domain";
import { useQuery } from "convex/react";
import { useState } from "react";
import { AvailabilityBadge, CategorySelect } from "./ui";

export function PublicToolList() {
  const [category, setCategory] = useState<Category | undefined>();
  const tools = useQuery(api.tools.listPublic, { category });

  return (
    <section aria-labelledby="tools-heading">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 id="tools-heading" className="text-xl font-semibold">
          On the shelf right now
        </h2>
        <label className="flex items-center gap-2 text-sm text-stone-600">
          Category
          <CategorySelect value={category} onChange={setCategory} allLabel="All" />
        </label>
      </div>

      {tools === undefined ? (
        <p className="mt-6 text-sm text-stone-500">Loading tools…</p>
      ) : tools.length === 0 ? (
        <p className="mt-6 text-sm text-stone-500">
          Nothing listed here yet. Sign up and be the first to lend.
        </p>
      ) : (
        <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {tools.map((tool) => (
            <li
              key={tool._id}
              className="flex items-start justify-between gap-3 rounded-lg border border-stone-200 bg-white p-4"
            >
              <div className="min-w-0">
                <p className="truncate font-medium">{tool.name}</p>
                <p className="text-sm text-stone-500">{tool.category}</p>
              </div>
              <AvailabilityBadge available={tool.available} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
