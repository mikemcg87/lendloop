"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { Category } from "@convex/lib/domain";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import {
  AvailabilityBadge,
  buttonDanger,
  buttonPrimary,
  buttonSecondary,
  CategorySelect,
  ErrorText,
  inputClass,
  useRun,
} from "../ui";
import { ToolImage } from "./BrowseTools";

type Tool = FunctionReturnType<typeof api.tools.listMine>[number];

function ToolForm({ tool, onDone }: { tool?: Tool; onDone: () => void }) {
  const generateUploadUrl = useMutation(api.tools.generateUploadUrl);
  const createTool = useMutation(api.tools.create);
  const updateTool = useMutation(api.tools.update);
  const { run, error, pending } = useRun();
  const [name, setName] = useState(tool?.name ?? "");
  const [category, setCategory] = useState<Category>(
    tool?.category ?? "Power Tools",
  );
  const [description, setDescription] = useState(tool?.description ?? "");
  const [photo, setPhoto] = useState<File | null>(null);

  async function uploadPhoto(file: File) {
    const response = await fetch(await generateUploadUrl(), {
      method: "POST",
      headers: { "Content-Type": file.type },
      body: file,
    });
    if (!response.ok) throw new Error("Upload failed");
    const { storageId } = (await response.json()) as {
      storageId: Id<"_storage">;
    };
    return storageId;
  }

  return (
    <form
      className="space-y-3 rounded-lg border border-stone-200 bg-white p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const ok = await run(async () => {
          const imageStorageId = photo ? await uploadPhoto(photo) : undefined;
          const fields = { name, category, description, imageStorageId };
          if (tool) await updateTool({ toolId: tool._id, ...fields });
          else await createTool(fields);
        });
        if (ok) onDone();
      }}
    >
      <h3 className="font-semibold">{tool ? "Edit listing" : "Add a tool"}</h3>
      <label className="block text-sm font-medium text-stone-700">
        Name
        <input
          required
          maxLength={80}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={`mt-1 ${inputClass}`}
        />
      </label>
      <label className="block text-sm font-medium text-stone-700">
        Category
        <div className="mt-1">
          <CategorySelect
            value={category}
            onChange={(value) => value && setCategory(value)}
          />
        </div>
      </label>
      <label className="block text-sm font-medium text-stone-700">
        Description
        <textarea
          rows={3}
          maxLength={1000}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className={`mt-1 ${inputClass}`}
        />
      </label>
      <label className="block text-sm font-medium text-stone-700">
        Photo {tool?.imageUrl ? "(leave empty to keep the current one)" : "(optional)"}
        <input
          type="file"
          accept="image/*"
          onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
          className="mt-1 block w-full text-sm"
        />
      </label>
      <ErrorText error={error} />
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className={buttonPrimary}>
          {pending ? "Saving…" : tool ? "Save changes" : "Add tool"}
        </button>
        <button type="button" onClick={onDone} className={buttonSecondary}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function ListingCard({ tool, onEdit }: { tool: Tool; onEdit: () => void }) {
  const removeTool = useMutation(api.tools.remove);
  const { run, error, pending } = useRun();
  return (
    <li className="rounded-lg border border-stone-200 bg-white p-4">
      <ToolImage url={tool.imageUrl} name={tool.name} />
      <div className="mt-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium">{tool.name}</p>
          <p className="text-sm text-stone-500">{tool.category}</p>
        </div>
        <AvailabilityBadge available={tool.available} />
      </div>
      {tool.description && (
        <p className="mt-2 text-sm text-stone-700">{tool.description}</p>
      )}
      <div className="mt-3 flex gap-2">
        <button onClick={onEdit} className={buttonSecondary}>
          <Pencil className="mr-1 inline size-4" aria-hidden />
          Edit
        </button>
        <button
          disabled={pending}
          onClick={() => {
            if (window.confirm(`Delete "${tool.name}"?`)) {
              void run(() => removeTool({ toolId: tool._id }));
            }
          }}
          className={buttonDanger}
        >
          <Trash2 className="mr-1 inline size-4" aria-hidden />
          Delete
        </button>
      </div>
      <div className="mt-2">
        <ErrorText error={error} />
      </div>
    </li>
  );
}

export function MyListings() {
  const tools = useQuery(api.tools.listMine);
  // "new" for the add form, a tool id while editing, null when closed.
  const [editing, setEditing] = useState<Id<"tools"> | "new" | null>(null);
  const editingTool = tools?.find((tool) => tool._id === editing);

  return (
    <section className="space-y-4">
      {editing === "new" ? (
        <ToolForm onDone={() => setEditing(null)} />
      ) : editingTool ? (
        <ToolForm
          key={editingTool._id}
          tool={editingTool}
          onDone={() => setEditing(null)}
        />
      ) : (
        <button onClick={() => setEditing("new")} className={buttonPrimary}>
          <Plus className="mr-1 inline size-4" aria-hidden />
          Add a tool
        </button>
      )}

      {tools === undefined ? (
        <p className="text-sm text-stone-500">Loading your listings…</p>
      ) : tools.length === 0 ? (
        <p className="text-sm text-stone-500">
          You have not listed anything yet.
        </p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {tools.map((tool) => (
            <ListingCard
              key={tool._id}
              tool={tool}
              onEdit={() => setEditing(tool._id)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
