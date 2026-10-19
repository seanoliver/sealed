import { SiteFooter } from "@/components/site-footer";

export default function RecipientLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <SiteFooter />
    </>
  );
}
