import clsx from "clsx";

/**
 * Ambient backdrop behind the whole app shell (sidebar + Workbench), not
 * just the auth screens like `AuroraBackground`. Always mounted once in the
 * `(app)` layout; which variant shows and how strong is pure CSS, driven by
 * `data-background` / `data-background-intensity` on `<html>` (see
 * `PreferencesEffect` and the rules in globals.css) — the component itself
 * doesn't read the preference, so it can't drift from what CSS renders.
 *
 * Only visible where a surface is translucent (`data-surface="glass"`,
 * see Settings → Внешний вид): solid sidebar/panels/cards fully occlude it,
 * same as any backdrop would.
 */
export function AppBackground(): React.ReactElement {
  return (
    <div aria-hidden className="orion-app-background pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="orion-app-background-aurora absolute inset-0 opacity-0 transition-opacity duration-500">
        <div className="orion-aurora-blob absolute -left-1/4 -top-1/3 h-[46rem] w-[46rem] rounded-full bg-accent/90 blur-[90px]" />
        <div
          className="orion-aurora-blob absolute -right-1/4 top-1/4 h-[40rem] w-[40rem] rounded-full bg-fuchsia-500/70 blur-[100px]"
          style={{ animationDelay: "-6s" }}
        />
        <div
          className="orion-aurora-blob absolute bottom-[-12rem] left-1/3 h-[36rem] w-[36rem] rounded-full bg-accent/70 blur-[95px]"
          style={{ animationDelay: "-11s" }}
        />
      </div>
      <div
        className={clsx("orion-app-background-grid absolute inset-0 opacity-0 transition-opacity duration-500")}
        style={{
          backgroundImage:
            "linear-gradient(rgba(var(--orion-accent) / 0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(var(--orion-accent) / 0.5) 1px, transparent 1px)",
          backgroundSize: "44px 44px"
        }}
      />
    </div>
  );
}
