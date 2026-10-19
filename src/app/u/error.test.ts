import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import RecipientError from "./error";

describe("recipient error page", () => {
  it("offers a retry and shows no error details", () => {
    const html = renderToStaticMarkup(
      createElement(RecipientError, {
        unstable_retry: vi.fn(),
        error: Object.assign(new Error("secret token abc"), { digest: "d1" }),
      } as never),
    );
    expect(html).toContain("Something went wrong");
    expect(html).toContain("Try again");
    expect(html).not.toContain("secret token abc");
    expect(html).not.toContain("d1");
  });
});
