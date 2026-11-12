"use client";

export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: readonly { id: T; label: string }[];
  active: T;
  onChange: (id: T) => void;
}) {
  return (
    <div
      role="tablist"
      className="flex gap-6 overflow-x-auto border-b border-ink/20 pb-3 font-mono text-[13px]"
    >
      {tabs.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          aria-selected={tab.id === active}
          onClick={() => onChange(tab.id)}
          className={`whitespace-nowrap underline-offset-[6px] ${
            tab.id === active
              ? "font-medium underline decoration-[1.5px]"
              : "text-ink-soft hover:text-ink"
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
