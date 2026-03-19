import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import ChatApp from "@/components/ChatApp";

export default async function HomePage() {
  const supabase = await createClient();

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    redirect("/login");
  }

  return <ChatApp userEmail={user.email ?? ""} />;
}