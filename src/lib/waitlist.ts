/**
 * Message private.before_user_created_hook returns when it rejects an email
 * that is not approved. Supabase passes it through unchanged: as the error
 * message from signInWithOtp, and as error_description on the OAuth redirect.
 */
export const WAITLIST_REJECTION = "sealed_waitlisted";
