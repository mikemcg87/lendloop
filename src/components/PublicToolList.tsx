"use client";

import { api } from "@convex/_generated/api";
import { CATEGORIES, type Category } from "@convex/lib/domain";
import { useQuery } from "convex/react";
import { useState } from "react";
import { columnHead, ledgerRow, meta, Note, Select } from "./ui";

export function PublicToolList() {
  const [category, setCategory] = useState<Category | undefined>();
  const tools = useQuery(api.tools.listPublic, { category });

  return (
    <section aria-labelledby="shelf-heading">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <h2 id="shelf-heading" className="text-base italic text-ink-soft">
          On the shelf today
        </h2>
        <label className={`${meta} flex items-center gap-2`}>
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
        <Note>Fetching the shelf…</Note>
      ) : tools.length === 0 ? (
        <Note>Nothing on the shelf here yet. Sign in and lend the first tool.</Note>
      ) : (
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className={columnHead}>Tool</th>
              <th className={`${columnHead} text-right`}>Category</th>
            </tr>
          </thead>
          <tbody>
            {tools.map((tool) => (
              <tr key={tool._id} className={ledgerRow}>
                <td className="py-2.5 pr-4">{tool.name}</td>
                <td className={`${meta} py-2.5 text-right`}>{tool.category}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
