import clsx from "clsx";
import type { ButtonHTMLAttributes, ReactNode } from "react";

export function IconButton({
  label,
  icon,
  className,
  type = "button",
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label" | "title"> & {
  label: string;
  icon: ReactNode;
}) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={clsx("icon-button", className)}
      {...props}
    >
      {icon}
    </button>
  );
}
