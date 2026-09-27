import clsx from "clsx";

/**
 * Decorative ambient backdrop for low-density screens (auth, empty states) —
 * ORION's take on Aceternity's Aurora/Grid backgrounds, hand-rolled in pure
 * CSS to avoid a rAF loop for something purely decorative. `aria-hidden`,
 * `pointer-events-none`, and the drift animation is disabled globally under
 * `prefers-reduced-motion` (see globals.css).
 */
export function AuroraBackground({ className }: { className?: string }): React.ReactElement {
  return (
    <div aria-hidden className={clsx("pointer-events-none absolute inset-0 overflow-hidden", className)}>
      <div className="orion-aurora-blob absolute -top-1/3 -left-1/4 h-[36rem] w-[36rem] rounded-full bg-accent/20 blur-[110px]" />
      <div
        className="orion-aurora-blob absolute top-1/4 -right-1/4 h-[30rem] w-[30rem] rounded-full bg-fuchsia-500/10 blur-[120px]"
        style={{ animationDelay: "-6s" }}
      />
      <div
        className="orion-aurora-blob absolute bottom-[-10rem] left-1/3 h-[28rem] w-[28rem] rounded-full bg-accent/10 blur-[110px]"
        style={{ animationDelay: "-11s" }}
      />
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)",
          backgroundSize: "44px 44px",
          maskImage: "radial-gradient(ellipse 75% 55% at 50% 0%, black 35%, transparent 100%)",
          WebkitMaskImage: "radial-gradient(ellipse 75% 55% at 50% 0%, black 35%, transparent 100%)"
        }}
      />
    </div>
  );
}
