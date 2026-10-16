"use client";

import { useFormStatus } from "react-dom";

/**
 * Submit button with useFormStatus pending state: disabled + swapped label
 * while the enclosing form's action is in flight. Must be rendered INSIDE
 * the <form> whose status it reports.
 */
export function SubmitButton({
  children,
  pendingLabel,
  className,
  disabled = false,
}: {
  children: React.ReactNode;
  pendingLabel: string;
  className?: string;
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      aria-busy={pending}
      className={`${className ?? ""} disabled:cursor-not-allowed disabled:opacity-60`}
    >
      {pending ? pendingLabel : children}
    </button>
  );
}
