"use client";

import Link from "next/link";
import { useActionState } from "react";
import { approveMerge, approveNew, reject } from "./actions";

const approveButtonClasses =
  "inline-flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/80 disabled:cursor-not-allowed disabled:opacity-50 ";
const rejectButtonClasses =
  "inline-flex h-9 items-center rounded-lg border border-input bg-card px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50  ";

/**
 * Approve/Reject buttons for one review card. `approve` picks the approval
 * action ("new" → Add contact, "merge" → Apply update); omit it for
 * malformed submissions, which can only be rejected.
 */
export function ReviewCardActions({
  submissionId,
  approve,
  compareHref,
  backHref,
  contactId,
}: {
  submissionId: string;
  approve?: "new" | "merge";
  compareHref?: string;
  backHref?: string;
  contactId?: string;
}) {
  const [approveState, approveAction, approvePending] = useActionState(
    approve === "merge" ? approveMerge : approveNew,
    {},
  );
  const [rejectState, rejectAction, rejectPending] = useActionState(reject, {});

  const pending = approvePending || rejectPending;
  const error = approveState.error ?? rejectState.error;

  return (
    <div className="mt-4">
      {error ? (
        <p
          role="alert"
          className="mb-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
        >
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {compareHref ? (
          <Link href={compareHref} className={approveButtonClasses}>
            Compare
          </Link>
        ) : null}
        {approve ? (
          <form action={approveAction}>
            <input type="hidden" name="id" value={submissionId} />
            {contactId ? <input type="hidden" name="contact_id" value={contactId} /> : null}
            <button
              type="submit"
              disabled={pending}
              className={compareHref ? rejectButtonClasses : approveButtonClasses}
            >
              {approve === "merge" ? "Apply update" : "Add contact"}
            </button>
          </form>
        ) : null}
        <form action={rejectAction}>
          <input type="hidden" name="id" value={submissionId} />
          <button
            type="submit"
            disabled={pending}
            className={rejectButtonClasses}
          >
            Reject
          </button>
        </form>
        {backHref ? (
          <Link href={backHref} className={rejectButtonClasses}>
            Back
          </Link>
        ) : null}
      </div>
    </div>
  );
}
