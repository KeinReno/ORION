import clsx from "clsx";
import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, TextareaHTMLAttributes } from "react";

export function Button({
  className,
  variant = "primary",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "danger" }): React.ReactElement {
  return (
    <button
      className={clsx(
        "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50",
        variant === "primary" && "bg-white text-neutral-950 hover:bg-white/90",
        variant === "ghost" && "bg-white/5 text-white hover:bg-white/10",
        variant === "danger" && "bg-red-500/10 text-red-300 hover:bg-red-500/20",
        className
      )}
      {...props}
    />
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>): React.ReactElement {
  return (
    <input
      {...props}
      className={clsx(
        "w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30 outline-none focus:border-white/30",
        props.className
      )}
    />
  );
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>): React.ReactElement {
  return (
    <textarea
      {...props}
      className={clsx(
        "w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30 outline-none focus:border-white/30",
        props.className
      )}
    />
  );
}

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>): React.ReactElement {
  return <div className={clsx("rounded-2xl border border-white/10 bg-white/[0.03] p-4", className)} {...props} />;
}
