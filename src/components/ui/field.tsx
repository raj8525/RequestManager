import clsx from "clsx";
import type { ReactNode } from "react";

export function Field({
  label,
  htmlFor,
  hint,
  error,
  required,
  className,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string;
  required?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const hintId = hint ? `${htmlFor}-hint` : undefined;
  const errorId = error ? `${htmlFor}-error` : undefined;
  return (
    <div className={clsx("field", className)}>
      <label className="field__label" htmlFor={htmlFor}>
        {label}
        {required ? (
          <span className="field__required" aria-hidden="true">
            必填
          </span>
        ) : null}
      </label>
      {children}
      {hint ? (
        <p className="field__hint" id={hintId}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p className="field__error" id={errorId} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function fieldDescriptionIds(
  id: string,
  options: { hint?: boolean; error?: boolean },
): string | undefined {
  const ids = [
    options.hint ? `${id}-hint` : null,
    options.error ? `${id}-error` : null,
  ].filter(Boolean);
  return ids.length > 0 ? ids.join(" ") : undefined;
}
