import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // dbAdmin bypasses RLS and the Supabase admin client bypasses Auth:
  // restrict imports of both admin modules to the
  // sanctioned call sites (private.* definer calls, token minting, webhook
  // status updates). Everything owner-facing goes through withRls.
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/db/admin"],
              message:
                "dbAdmin bypasses RLS. Use withRls from @/lib/db for owner-facing data access; dbAdmin is only for private.* SECURITY DEFINER calls, update_token minting, and webhook status updates (see the allowlisted paths in eslint.config.mjs).",
            },
            {
              group: ["**/supabase/admin"],
              message:
                "The Supabase admin client holds the secret key and bypasses Auth checks. Only the allowlisted admin paths in eslint.config.mjs may import it.",
            },
          ],
        },
      ],
    },
  },
  {
    files: [
      "src/lib/db/**",
      "src/app/api/webhooks/**",
      "src/app/u/**",
      "src/app/b/**",
      "src/app/dashboard/actions.ts",
      // Sanctioned: the waitlist is private-schema only, and the invitation's
      // sign-in link needs the Auth admin API; every call is gated by
      // requireAdmin (ADMIN_EMAILS).
      "src/app/admin/**",
      // Sanctioned: the public permalink surface is unauthenticated (no
      // claims for withRls); this module selects ONLY title/owner name/
      // enabled-field flags by slug — never ids, counts, or contact data.
      "src/lib/queries/public-book.ts",
      // ... and its integration test, which seeds fixtures as admin.
      "src/lib/queries/public-book.test.ts",
      // Sanctioned: contact CRUD writes go through withRls; dbAdmin is used
      // ONLY to append contact_events audit rows after a successful RLS
      // write (contact_events is client-unwritable by design — no insert
      // policy or grant for `authenticated`).
      "src/app/dashboard/contacts/actions.ts",
      // Sanctioned: same audit-append pattern — review approvals write
      // contacts/submissions through withRls and use dbAdmin ONLY for the
      // contact_events row (source 'submission') after the RLS write.
      "src/app/dashboard/review/actions.ts",
      // ... and the concurrency guardrail test, which seeds fixtures and
      // asserts post-conditions as admin (the replayed approve transactions
      // themselves run through withRls).
      "src/app/dashboard/review/approve-race.test.ts",
    ],
    rules: { "no-restricted-imports": "off" },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
