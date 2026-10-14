import { redirect } from "next/navigation";

/** Sign-in and sign-up share the entry page at `/`; old links land there. */
export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  redirect(error ? "/?error=1" : "/");
}
