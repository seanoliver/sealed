export const OWNER_NAV_LINKS = [
  { href: "/dashboard", label: "Contacts" },
  { href: "/dashboard/review", label: "Review" },
  { href: "/dashboard/agents", label: "Agents" },
  { href: "/dashboard/settings", label: "Settings" },
] as const;

/** Contact detail, import and export pages belong to Contacts. */
export function currentNavHref(pathname: string): string {
  const section = OWNER_NAV_LINKS.find(
    ({ href }) => href !== "/dashboard" && (pathname === href || pathname.startsWith(`${href}/`)),
  );
  return section?.href ?? "/dashboard";
}
