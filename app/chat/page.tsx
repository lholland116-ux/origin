import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import ChatClient from "./ChatClient";

export default async function ChatPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return <ChatClient userEmail={user.email ?? ""} />;
}