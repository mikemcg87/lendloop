"use client";

import { api } from "@convex/_generated/api";
import { CATEGORIES, type Category } from "@convex/lib/domain";
import { useQuery } from "convex/react";
import { useState } from "react";
import { Select } from "./ui";

export function PublicToolList() {
  const [category, setCategory] = useState<Category | undefined>();
  const tools = useQuery(api.tools.listPublic, { category });

  return (
    <section aria-labelledby="tools-heading">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 id="tools-heading" className="text-xl font-semibold">
          Available to borrow right now
        </h2>
        <label className="flex items-center gap-2 text-sm text-stone-600">
          Category
          <Select
            value={category}
            onChange={setCategory}
            options={CATEGORIES}
            allLabel="All"
          />
        </label>
      </div>

      {tools === undefined ? (
        <p className="mt-6 text-sm text-stone-500">Loading tools…</p>
      ) : tools.length === 0 ? (
        <p className="mt-6 text-sm text-stone-500">
          Nothing available here right now. Sign in and be the first to lend.
        </p>
      ) : (
        <ul className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {tools.map((tool) => (
            <li
              key={tool._id}
              className="rounded-lg border border-stone-200 bg-white p-4"
            >
              <p className="truncate font-medium">{tool.name}</p>
              <p className="text-sm text-stone-500">{tool.category}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
