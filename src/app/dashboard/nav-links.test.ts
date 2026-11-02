import { describe, expect, it } from "vitest";
import { currentNavHref } from "./nav-links";

describe("currentNavHref", () => {
  it.each([
    ["/dashboard", "/dashboard"],
    ["/dashboard/contacts/0b5c", "/dashboard"],
    ["/dashboard/import", "/dashboard"],
    ["/dashboard/export", "/dashboard"],
    ["/dashboard/review", "/dashboard/review"],
    ["/dashboard/review/abc", "/dashboard/review"],
    ["/dashboard/agents", "/dashboard/agents"],
    ["/dashboard/settings", "/dashboard/settings"],
    ["/dashboard/settings/email", "/dashboard/settings"],
    ["/dashboard/reviewers", "/dashboard"],
  ])("%s belongs to %s", (pathname, href) => {
    expect(currentNavHref(pathname)).toBe(href);
  });
});
