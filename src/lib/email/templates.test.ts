import { describe, expect, it } from "vitest";
import {
  addressRequestEmail,
  healthCheckFailedEmail,
  submissionNotificationEmail,
  waitlistApprovedEmail,
} from "./templates";

const addressRequest = {
  ownerName: "Sean O",
  updateUrl: "https://self-hosted.example/u/abc123",
};

describe("addressRequestEmail", () => {
  it("identifies Sealed in every email representation", () => {
    const { subject, html, text } = addressRequestEmail(addressRequest);
    for (const part of [subject, html, text]) {
      expect(part).toContain("Sealed");
    }
  });

  it("uses the owner name and title-free address-book copy", () => {
    const { subject, html, text } = addressRequestEmail(addressRequest);
    expect(subject).toBe(
      "Sean O would like your current mailing address · Sealed",
    );
    expect(html).toContain("Sean O is updating their address book");
    expect(text).toContain("Sean O is updating their address book");
  });

  it("keeps the configured self-hosted update URL in html and text", () => {
    const { html, text } = addressRequestEmail(addressRequest);
    expect(html).toContain(`href="${addressRequest.updateUrl}"`);
    expect(text).toContain(addressRequest.updateUrl);
    expect(`${html}${text}`).not.toContain("sealed.page");
  });

  it("mentions the 30-day expiry", () => {
    const { html, text } = addressRequestEmail(addressRequest);
    expect(html).toContain("expires in 30 days");
    expect(text).toContain("expires in 30 days");
  });

  it("strips control characters from the owner name in the subject", () => {
    const { subject } = addressRequestEmail({
      ...addressRequest,
      ownerName: "Eve\r\nBcc: victim@test.dev\tX",
    });
    expect(subject).toBe(
      "Eve Bcc: victim@test.dev X would like your current mailing address · Sealed",
    );
    expect(subject).not.toMatch(/[\r\n\t]/);
  });

  it("escapes the user-controlled owner name in html", () => {
    const { html } = addressRequestEmail({
      ...addressRequest,
      ownerName: `<script>alert("x")</script>`,
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
  });
});

describe("submissionNotificationEmail", () => {
  const notification = {
    reviewUrl: "https://self-hosted.example/dashboard/review",
  };

  it("identifies Sealed in every email representation", () => {
    const { subject, html, text } = submissionNotificationEmail(notification);
    for (const part of [subject, html, text]) {
      expect(part).toContain("Sealed");
    }
  });

  it("uses title-free submission copy", () => {
    const { subject, html, text } = submissionNotificationEmail(notification);
    expect(subject).toBe("New address submission · Sealed");
    expect(html).toContain("Someone added their info through your public link");
    expect(text).toContain("Someone added their info through your public link");
  });

  it("keeps the configured self-hosted review URL in html and text", () => {
    const { html, text } = submissionNotificationEmail(notification);
    expect(html).toContain(`href="${notification.reviewUrl}"`);
    expect(text).toContain(notification.reviewUrl);
    expect(`${html}${text}`).not.toContain("sealed.page");
  });

  it("contains no placeholder for submitted data", () => {
    const { html, text, subject } = submissionNotificationEmail(notification);
    for (const part of [html, text, subject]) {
      expect(part).not.toContain("undefined");
      expect(part).not.toMatch(/\$\{/);
    }
  });
});

describe("healthCheckFailedEmail", () => {
  const alert = {
    environment: "production",
    checkedAt: new Date("2026-10-13T12:00:00.000Z"),
  };

  it("identifies Sealed, the environment, and the time in every representation", () => {
    const { subject, html, text } = healthCheckFailedEmail(alert);
    expect(subject).toBe("Database health check failed (production) · Sealed");
    for (const part of [html, text]) {
      expect(part).toContain("Sealed");
      expect(part).toContain("production");
      expect(part).toContain("2026-10-13T12:00:00.000Z");
    }
  });

  it("strips control characters and escapes the environment label", () => {
    const { subject, html } = healthCheckFailedEmail({
      ...alert,
      environment: "<b>x</b>\r\nBcc: a@b.c",
    });
    expect(subject).not.toMatch(/[\r\n]/);
    expect(html).not.toContain("<b>x</b>");
  });
});

describe("waitlistApprovedEmail", () => {
  it("links to the sign-in URL in html and text, escaping it", () => {
    const { subject, html, text } = waitlistApprovedEmail({
      signInUrl: "https://app.example/auth/confirm?token_hash=a&type=magiclink",
      appUrl: "https://app.example",
    });
    expect(subject).toBe("You’re invited to Sealed");
    expect(html).toContain(
      'href="https://app.example/auth/confirm?token_hash=a&amp;type=magiclink"',
    );
    expect(text).toContain(
      "Sign in: https://app.example/auth/confirm?token_hash=a&type=magiclink",
    );
  });

  it("says where to get a new link once this one expires", () => {
    const { html, text } = waitlistApprovedEmail({
      signInUrl: "https://app.example/auth/confirm?token_hash=a&type=magiclink",
      appUrl: "https://app.example",
    });
    expect(html).toContain('<a href="https://app.example"');
    expect(text).toContain("go to https://app.example and enter this email address");
  });
});
