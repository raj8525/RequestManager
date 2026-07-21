import clsx from "clsx";
import type { ReactNode } from "react";

export function Badge({
  tone = "neutral",
  children,
  className,
}: {
  tone?: "neutral" | "info" | "blue" | "warning" | "danger" | "success";
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={clsx("badge", `badge--${tone}`, className)}>{children}</span>
  );
}
