"use client";

import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
  CATEGORIES,
  CONDITIONS,
  type Category,
  type Condition,
} from "@convex/lib/domain";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useState } from "react";
import {
  buttonPrimary,
  buttonSecondary,
  columnHead,
  ConfirmAction,
  ErrorText,
  fieldLabel,
  inputClass,
  ledgerRow,
  linkAction,
  meta,
  Note,
  SectionTitle,
  Select,
  useRun,
} from "../ui";
import { ToolThumb } from "./BrowseTools";

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
  const [condition, setCondition] = useState<Condition>(
    tool?.condition ?? "Good",
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
      className="max-w-xl space-y-4 border border-ink bg-slip p-5"
      onSubmit={async (e) => {
        e.preventDefault();
        const ok = await run(async () => {
          const imageStorageId = photo ? await uploadPhoto(photo) : undefined;
          const fields = {
            name,
            category,
            condition,
            description,
            imageStorageId,
          };
          if (tool) await updateTool({ toolId: tool._id, ...fields });
          else await createTool(fields);
        });
        if (ok) onDone();
      }}
    >
      <h3 className="text-xl font-medium">
        {tool ? "Amend this entry" : "Add a tool to the board"}
      </h3>
      <label className={fieldLabel}>
        Name
        <input
          required
          maxLength={80}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Cordless drill"
          className={`mt-1 font-serif text-ink ${inputClass}`}
        />
      </label>
      <div className="flex flex-wrap gap-5">
        <label className={fieldLabel}>
          Category
          <div className="mt-1">
            <Select
              value={category}
              onChange={(value) => value && setCategory(value)}
              options={CATEGORIES}
            />
          </div>
        </label>
        <label className={fieldLabel}>
          Condition
          <div className="mt-1">
            <Select
              value={condition}
              onChange={(value) => value && setCondition(value)}
              options={CONDITIONS}
            />
          </div>
        </label>
      </div>
      <label className={fieldLabel}>
        Short description
        <textarea
          rows={2}
          maxLength={300}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="18V, two batteries and a charger in the case."
          className={`mt-1 font-serif text-ink ${inputClass}`}
        />
      </label>
      <label className={fieldLabel}>
        Photo{" "}
        {tool?.imageUrl ? "(leave empty to keep the current one)" : "(optional)"}
        <input
          type="file"
          accept="image/*"
          onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
          className="mt-1 block w-full"
        />
      </label>
      <ErrorText error={error} />
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className={buttonPrimary}>
          {pending ? "Saving…" : tool ? "Save changes" : "Add to the board"}
        </button>
        <button type="button" onClick={onDone} className={buttonSecondary}>
          Never mind
        </button>
      </div>
    </form>
  );
}

function ListingRow({ tool, onEdit }: { tool: Tool; onEdit: () => void }) {
  const removeTool = useMutation(api.tools.remove);
  const { run, error, pending } = useRun();
  return (
    <tr className={ledgerRow}>
      <td className="py-3 pr-4">
        <div className="flex items-start gap-3">
          <ToolThumb url={tool.imageUrl} name={tool.name} />
          <div className="min-w-0">
            {tool.name}
            <p className={meta}>
              {tool.category} · {tool.condition.toLowerCase()}
            </p>
            {tool.description && (
              <p className="mt-1 text-[15px] text-ink-soft">{tool.description}</p>
            )}
            <ErrorText error={error} />
          </div>
        </div>
      </td>
      <td className={`${meta} py-3 pr-4 align-top whitespace-nowrap`}>
        {tool.available ? "on the shelf" : "out on loan"}
      </td>
      <td className="py-3 text-right align-top whitespace-nowrap">
        <span className="inline-flex items-center gap-4">
          <button onClick={onEdit} className={linkAction}>
            amend
          </button>
          <ConfirmAction
            label="remove"
            confirmLabel="yes, remove"
            disabled={pending}
            onConfirm={() => void run(() => removeTool({ toolId: tool._id }))}
          />
        </span>
      </td>
    </tr>
  );
}

export function MyListings() {
  const tools = useQuery(api.tools.listMine);
  // "new" for the add form, a tool id while editing, null when closed.
  const [editing, setEditing] = useState<Id<"tools"> | "new" | null>(null);
  const editingTool = tools?.find((tool) => tool._id === editing);

  return (
    <section className="space-y-6">
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
          + Add a tool
        </button>
      )}

      <div>
        <SectionTitle>What you lend</SectionTitle>
        {tools === undefined ? (
          <Note>Fetching your entries…</Note>
        ) : tools.length === 0 ? (
          <Note>
            Nothing under your name yet. That drill you use twice a year would
            be a good start.
          </Note>
        ) : (
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={columnHead}>Tool</th>
                <th className={columnHead}>Where</th>
                <th className={columnHead}>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {tools.map((tool) => (
                <ListingRow
                  key={tool._id}
                  tool={tool}
                  onEdit={() => setEditing(tool._id)}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
