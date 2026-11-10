import { describe, expect, it } from "vitest";
import { VercelAnalytics } from "./vercel-analytics";

type BeforeSend = (event: { type: string; url: string }) => { type: string; url: string } | null;

describe("VercelAnalytics", () => {
  it("redacts every event's URL before it is sent", () => {
    const element = VercelAnalytics() as unknown as { props: { beforeSend: BeforeSend } };
    expect(element.props.beforeSend({ type: "pageview", url: "https://sealed.page/u/Abc123_-Xyz7890abcdefghijklmnopqrstuvwxyzAB/confirm?x=1" })).toEqual({
      type: "pageview",
      url: "https://sealed.page/u/[token]/confirm",
    });
  });

  it("drops an event for a /u/ path that is not a recipient route", () => {
    const element = VercelAnalytics() as unknown as { props: { beforeSend: BeforeSend } };
    expect(element.props.beforeSend({ type: "pageview", url: "https://sealed.page/u/Abc123_-Xyz7890abcdefghijklmnopqrstuvwxyzAB/x" })).toBeNull();
  });
});
