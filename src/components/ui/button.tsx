import clsx from "clsx";
import type { ButtonHTMLAttributes } from "react";

export type ButtonVariant = "primary" | "secondary" | "danger" | "quiet";
export type ButtonSize = "small" | "medium";

export function buttonClassName({
  variant = "primary",
  size = "medium",
  className,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
} = {}): string {
  return clsx(
    "button",
    `button--${variant}`,
    `button--${size}`,
    className,
  );
}

export function Button({
  variant = "primary",
  size = "medium",
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
}) {
  return (
    <button
      type={type}
      className={buttonClassName({ variant, size, className })}
      {...props}
    />
  );
}
