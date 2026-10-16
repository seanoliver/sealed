/** Must match the reject message in private.before_user_created_hook. */
export const WAITLIST_REJECTION = "sealed_waitlisted";

/** Mirror the check constraints on private.waitlist. */
export type WaitlistStatus = "pending" | "approved";
export type WaitlistSource = "email" | "google";
