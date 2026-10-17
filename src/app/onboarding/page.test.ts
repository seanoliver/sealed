import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { requireUser } from "@/lib/auth";
import { getOwnBook, getOwnProfile } from "@/lib/queries/books";
import { createClient } from "@/lib/supabase/server";
import OnboardingPage from "./page";

vi.mock("@/lib/auth", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/queries/books", () => ({ getOwnBook: vi.fn(), getOwnProfile: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("./onboarding-form", () => ({ OnboardingForm: () => null }));

type FormElement = ReactElement<{ defaults: { display_name: string } }>;

async function prefilledName(): Promise<string> {
  const page = (await OnboardingPage()) as ReactElement<{ children: FormElement }>;
  return page.props.children.props.defaults.display_name;
}

function signedInAs(user: Record<string, unknown>) {
  vi.mocked(createClient).mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }) },
  } as unknown as Awaited<ReturnType<typeof createClient>>);
}

describe("OnboardingPage display name", () => {
  beforeEach(() => {
    vi.mocked(requireUser).mockResolvedValue({
      sub: "u1",
      email: "ada@example.com",
      user_metadata: { full_name: "Chosen Name" },
    });
    vi.mocked(getOwnBook).mockResolvedValue(null as never);
    vi.mocked(getOwnProfile).mockResolvedValue({ displayName: "" } as never);
  });

  it("does not pre-fill a name a direct signUp put in user metadata", async () => {
    signedInAs({ user_metadata: { full_name: "Chosen Name" }, identities: [] });
    await expect(prefilledName()).resolves.toBe("");
  });

  it("pre-fills the name from a linked Google identity", async () => {
    signedInAs({
      identities: [
        { id: "g", user_id: "u1", identity_id: "g", provider: "google", identity_data: { full_name: "Ada" } },
      ],
    });
    await expect(prefilledName()).resolves.toBe("Ada");
  });

  it("keeps a name the owner already saved", async () => {
    vi.mocked(getOwnProfile).mockResolvedValue({ displayName: "Saved Name" } as never);
    await expect(prefilledName()).resolves.toBe("Saved Name");
  });
});
