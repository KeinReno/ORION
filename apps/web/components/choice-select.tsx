"use client";

import { GlideSelect, visualFieldClass } from "@orion/ui";

export interface ChoiceOption<T extends string> {
  value: T;
  label: string;
}

/** GlideSelect speaks labels; callers keep stable ids. Duplicate labels get a count so the menu can tell them apart. */
export function disambiguate<T extends string>(options: readonly ChoiceOption<T>[]): ChoiceOption<T>[] {
  const counts = new Map<string, number>();
  for (const option of options) counts.set(option.label, (counts.get(option.label) ?? 0) + 1);
  const seen = new Map<string, number>();
  return options.map((option) => {
    if ((counts.get(option.label) ?? 0) < 2) return option;
    const next = (seen.get(option.label) ?? 0) + 1;
    seen.set(option.label, next);
    return { ...option, label: `${option.label} (${next})` };
  });
}

export function ChoiceSelect<T extends string>({
  label,
  value,
  options,
  onChange,
  id,
  disabled = false,
  className
}: {
  label: string;
  value: T;
  options: readonly ChoiceOption<T>[];
  onChange: (value: T) => void;
  id?: string;
  disabled?: boolean;
  className?: string;
}): React.ReactElement {
  const unique = disambiguate(options);
  const current = unique.find((option) => option.value === value)?.label ?? unique[0]?.label ?? "";
  if (disabled) {
    return (
      <div className={className}>
        <button type="button" id={id} disabled aria-label={label} className={`${visualFieldClass} cursor-not-allowed opacity-60`}>
          {current}
        </button>
      </div>
    );
  }
  return (
    <div className={className}>
      <GlideSelect
        id={id}
        label={label}
        options={unique.map((option) => option.label)}
        value={current}
        onChange={(nextLabel) => {
          const next = unique.find((option) => option.label === nextLabel);
          if (next) onChange(next.value);
        }}
      />
    </div>
  );
}
