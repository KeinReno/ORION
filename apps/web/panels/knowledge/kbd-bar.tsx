"use client";

function Kbd({ children }: { children: React.ReactNode }): React.ReactElement {
  return <kbd className="rounded-md border border-border px-1.5 py-0.5 font-mono text-[11px] text-[#BEB9AF]">{children}</kbd>;
}

/** Подсказка клавиатуры внизу экрана входящих (экран 02). */
export function KbdBar(): React.ReactElement {
  return (
    <p className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 py-2 text-[12px] text-[#6E6A60]">
      <span className="flex items-center gap-1.5"><Kbd>E</Kbd> принять</span>
      <span className="flex items-center gap-1.5"><Kbd>X</Kbd> в архив</span>
      <span className="flex items-center gap-1.5"><Kbd>J</Kbd><Kbd>K</Kbd> навигация</span>
    </p>
  );
}
