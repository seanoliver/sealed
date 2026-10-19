import type { Metadata } from "next";
import { SealedWordmark } from "@/components/sealed-mark";
import { BackLink } from "./back-link";

export const metadata: Metadata = {
  title: "What is Sealed?",
  description:
    "Sealed is a small address book for holiday cards, built by Sean Oliver.",
  alternates: { canonical: "/about" },
};

const CONTACT_EMAIL = "hello@sealed.page";

const SECTIONS = [
  {
    heading: "Who emailed me?",
    body: "The person named in the email. They added you to their card list, and Sealed sent the email for them.",
  },
  {
    heading: "Who sees my address?",
    body: "Only the person who asked. Your address isn’t sold, shared, or used for anything but their mail. An emailed link works for 30 days and only for you.",
  },
  {
    heading: "Who made this?",
    body: "Sean Oliver, a software engineer, built Sealed as a personal project. It’s in a small private beta, used by a handful of people for their own cards.",
  },
];

export default function AboutPage() {
  return (
    <main className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-8 px-4 py-10">
      <div className="flex items-center justify-between">
        <SealedWordmark />
        <BackLink />
      </div>
      <div className="flex flex-col gap-3">
        <h1 className="font-serif text-4xl leading-tight text-foreground">
          What is Sealed?
        </h1>
        <p className="leading-relaxed text-muted-foreground">
          Sealed is a small address book for holiday cards. Someone you know
          uses it to ask for your mailing address, so they don’t have to text
          everyone each December.
        </p>
      </div>
      <div className="flex flex-col gap-6 border-t border-border pt-6">
        {SECTIONS.map(({ heading, body }) => (
          <section key={heading} className="flex flex-col gap-1.5">
            <h2 className="font-serif text-xl text-foreground">{heading}</h2>
            <p className="text-[15px] leading-relaxed text-muted-foreground">
              {body}
            </p>
          </section>
        ))}
        <section className="flex flex-col gap-1.5">
          <h2 className="font-serif text-xl text-foreground">
            I’d rather not be on the list
          </h2>
          <p className="text-[15px] leading-relaxed text-muted-foreground">
            Tell the person who sent the email, and they can remove you. You
            can also write to{" "}
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className="font-medium text-primary underline underline-offset-4"
            >
              {CONTACT_EMAIL}
            </a>{" "}
            and we’ll delete your details.
          </p>
        </section>
      </div>
    </main>
  );
}
