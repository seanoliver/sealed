import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { Pool } from "pg";
import { makeWithRls } from "@/lib/db";
import { dbAdmin } from "@/lib/db/admin";
import { isUniqueViolation } from "@/lib/db/errors";
import { contacts, submissions } from "@/lib/db/schema";

/**
 * Concurrency guardrail for the review approve actions (./actions.ts).
 *
 * approveNew/approveMerge gate on an atomic status flip INSIDE the same
 * transaction as the contact write:
 *
 *   update submissions set status='approved'
 *   where id=? and book_id=? and status='pending' returning id
 *
 * 0 rows ⇒ a concurrent approval already won ⇒ return without writing.
 * The actions module can't be imported under vitest (next/cache,
 * requireUser), so this replays approveNew's exact statement sequence
 * through withRls against the real local DB — if someone reorders the flip
 * after the insert, or splits it into check-then-act again, these tests
 * fail.
 */

const U = "00000000-0000-0000-0000-00000000c001";
const B = "10000000-0000-0000-0000-00000000c001";
const C_DUP = "20000000-0000-0000-0000-00000000c001";
const S_RACE = "30000000-0000-0000-0000-00000000c001";
const S_DUP = "30000000-0000-0000-0000-00000000c002";

const racePool = new Pool({ connectionString: process.env.DATABASE_URL!, max: 2 });
const withRls = makeWithRls(racePool);

/** One-shot barrier so two transactions can rendezvous mid-flight. */
function makeBarrier() {
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { wait, release };
}

type Barrier = ReturnType<typeof makeBarrier>;

/**
 * Replay of approveNew's transaction: read the pending submission, then the
 * atomic flip (the gate), then the contact insert. The barrier forces both
 * racers past the read BEFORE either attempts the flip — the exact
 * interleaving that made the old check-then-act version write twice.
 */
function replayApproveNew(mine: Barrier, theirs: Barrier) {
  return withRls({ sub: U }, async (tx) => {
    const [sub] = await tx
      .select()
      .from(submissions)
      .where(
        and(
          eq(submissions.id, S_RACE),
          eq(submissions.bookId, B),
          eq(submissions.status, "pending"),
        ),
      )
      .limit(1);
    if (!sub) return "lost_early";

    mine.release();
    await theirs.wait; // both transactions have now read status='pending'

    const won = await tx
      .update(submissions)
      .set({ status: "approved" })
      .where(
        and(
          eq(submissions.id, S_RACE),
          eq(submissions.bookId, B),
          eq(submissions.status, "pending"),
        ),
      )
      .returning({ id: submissions.id });
    if (won.length === 0) return "lost";

    await tx.insert(contacts).values({ bookId: B, fullName: "Race Winner" });
    return "won";
  });
}

describe("review approve concurrency gate", () => {
  beforeAll(async () => {
    // Cascade-delete any previous run's fixtures, then reseed. The postgres
    // role owns the tables, so it bypasses RLS and the no-insert policy on
    // submissions (mirroring private.submit_to_book's SECURITY DEFINER
    // write).
    await dbAdmin.execute(sql`delete from public.books where id = ${B}`);
    await dbAdmin.execute(sql`
      insert into auth.users (id, email) values (${U}, 'racetest@test.dev')
      on conflict (id) do nothing`);
    await dbAdmin.execute(sql`
      insert into public.books (id, owner_id, slug)
      values (${B}, ${U}, 'race-test-book')`);
    await dbAdmin.execute(sql`
      insert into public.contacts (id, book_id, full_name, email)
      values (${C_DUP}, ${B}, 'Existing Dup', 'dup@race.test')`);
    await dbAdmin.execute(sql`
      insert into public.submissions (id, book_id, payload) values
        (${S_RACE}, ${B}, '{"full_name": "Race Winner"}'::jsonb),
        (${S_DUP}, ${B}, '{"full_name": "Dup Race", "email": "dup@race.test"}'::jsonb)`);
  });

  afterAll(async () => {
    await racePool.end();
    // Leave no submissions behind: the pgTAP suite (supabase/tests) asserts
    // on GLOBAL submissions counts, so stray committed fixtures would fail
    // it. The book delete cascades contacts and submissions.
    await dbAdmin.execute(sql`delete from public.books where id = ${B}`);
    await dbAdmin.execute(sql`delete from auth.users where id = ${U}`);
  });

  it("two concurrent approvals of one email-less submission create exactly one contact", async () => {
    const a = makeBarrier();
    const b = makeBarrier();
    const results = await Promise.all([
      replayApproveNew(a, b),
      replayApproveNew(b, a),
    ]);

    // Exactly one winner; the loser saw 0 rows from the flip (the action
    // maps that to NOT_FOUND) and wrote nothing.
    expect([...results].sort()).toEqual(["lost", "won"]);

    const created = await dbAdmin
      .select({ id: contacts.id })
      .from(contacts)
      .where(and(eq(contacts.bookId, B), eq(contacts.fullName, "Race Winner")));
    expect(created).toHaveLength(1);

    const [sub] = await dbAdmin
      .select({ status: submissions.status })
      .from(submissions)
      .where(eq(submissions.id, S_RACE));
    expect(sub.status).toBe("approved");
  });

  it("a failed contact insert rolls the flip back to pending (duplicate email)", async () => {
    await expect(
      withRls({ sub: U }, async (tx) => {
        const won = await tx
          .update(submissions)
          .set({ status: "approved" })
          .where(
            and(
              eq(submissions.id, S_DUP),
              eq(submissions.bookId, B),
              eq(submissions.status, "pending"),
            ),
          )
          .returning({ id: submissions.id });
        expect(won).toHaveLength(1); // we won the flip...
        // ...but the insert hits contacts_book_email_unique and throws,
        // rolling back the whole transaction, flip included.
        await tx.insert(contacts).values({
          bookId: B,
          fullName: "Dup Race",
          email: "dup@race.test",
        });
      }),
    ).rejects.toSatisfy((e) =>
      isUniqueViolation(e, "contacts_book_email_unique"),
    );

    const [sub] = await dbAdmin
      .select({ status: submissions.status })
      .from(submissions)
      .where(eq(submissions.id, S_DUP));
    expect(sub.status).toBe("pending"); // stays actionable for the owner
  });
});
