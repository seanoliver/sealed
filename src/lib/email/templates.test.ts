import { describe, expect, it } from "vitest";
import {
  addressRequestEmail,
  healthCheckFailedEmail,
  contactUpdatedEmail,
  submissionNotificationEmail,
  waitlistApprovedEmail,
} from "./templates";

const addressRequest = {
  ownerName: "Sean O",
  updateUrl: "https://self-hosted.example/u/abc123",
  confirmUrl: "https://self-hosted.example/u/abc123/confirm",
  envelope: {
    household: "Priya Raman & Daniel Okafor",
    lines: ["Priya Raman & Daniel Okafor", "1428 Alder St, Apt 3", "Portland, OR 97214"],
  },
};
const noAddress = { ...addressRequest, envelope: { household: "Satya & Family", lines: null } };

describe("addressRequestEmail", () => {
  it("identifies Sealed in every email representation", () => {
    for (const input of [addressRequest, noAddress]) {
      const { subject, html, text } = addressRequestEmail(input);
      for (const part of [subject, html, text]) expect(part).toContain("Sealed");
    }
  });

  it("shows the envelope and asks whether it will arrive", () => {
    const { subject, html, text } = addressRequestEmail(addressRequest);
    expect(subject).toBe("Will Sean O's holiday card reach you? · Sealed");
    expect(html).toContain("Priya Raman &amp; Daniel Okafor<br>1428 Alder St, Apt 3<br>Portland, OR 97214");
    expect(text).toContain("  Priya Raman & Daniel Okafor\n  1428 Alder St, Apt 3\n  Portland, OR 97214");
    expect(html).toContain(`href="${addressRequest.confirmUrl}"`);
    expect(html).toContain(`href="${addressRequest.updateUrl}"`);
    expect(text).toContain(`Yes, send it here: ${addressRequest.confirmUrl}`);
    expect(text).toContain(`Fix a name or the address: ${addressRequest.updateUrl}`);
    expect(`${html}${text}`).not.toContain("sealed.page");
  });

  it("asks for an address, with no confirm link, when none is on file", () => {
    const { subject, html, text } = addressRequestEmail(noAddress);
    expect(subject).toBe("Where should Sean O send your holiday card? · Sealed");
    expect(html).toContain("Satya &amp; Family");
    expect(`${html}${text}`).not.toContain(addressRequest.confirmUrl);
    expect(text).toContain(`Add your names and address: ${addressRequest.updateUrl}`);
  });

  it("links Sealed to the about page on the app's own host", () => {
    for (const input of [addressRequest, noAddress]) {
      const { html, text } = addressRequestEmail(input);
      expect(html).toContain('<a href="https://self-hosted.example/about"');
      expect(text).toContain("Sent with Sealed (https://self-hosted.example/about)");
    }
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
    expect(subject).toBe("Will Eve Bcc: victim@test.dev X's holiday card reach you? · Sealed");
    expect(subject).not.toMatch(/[\r\n\t]/);
  });

  it("escapes the owner name and the envelope in html", () => {
    const { html } = addressRequestEmail({
      ...addressRequest,
      ownerName: `<script>alert("x")</script>`,
      envelope: { household: "<b>Ana</b>", lines: ["<b>Ana</b>", '1 "Main" <St>'] },
    });
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<b>Ana");
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    expect(html).toContain("1 &quot;Main&quot; &lt;St&gt;");
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

describe("contactUpdatedEmail", () => {
  const contactUrl = "https://self-hosted.example/dashboard/contacts/c1";

  it("links to the contact in html and text", () => {
    const { subject, html, text } = contactUpdatedEmail({ contactUrl });
    expect(subject).toBe("A contact checked their details · Sealed");
    expect(html).toContain(`href="${contactUrl}"`);
    expect(text).toContain(`View contact: ${contactUrl}`);
  });

  it("escapes the URL in html", () => {
    const { html } = contactUpdatedEmail({ contactUrl: 'https://x.example/"><b>' });
    expect(html).not.toContain('"><b>');
  });
});
