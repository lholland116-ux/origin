import {
  randomUUID,
} from "node:crypto";

import type {
  CapaApiHandlerDependencies,
} from "@/lib/capa/api/capa-route-handler";

import {
  selectCapaRuntime,
} from "@/lib/capa/application/capa-runtime-selection";

import type {
  SupabaseCapaSessionFacts,
} from "@/lib/security/supabase-capa-context";

import {
  createServerSupabaseClient,
} from "@/lib/supabase/server";

/**
 * Returns minimized, server-verified authentication facts.
 *
 * Raw credentials, provider tokens, passwords and browser-supplied
 * authorization values never cross the CAPA application boundary.
 */
async function getVerifiedSessionFacts():
  Promise<
    SupabaseCapaSessionFacts | null
  > {
  const supabase =
    await createServerSupabaseClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (
    userError !== null ||
    user === null
  ) {
    return null;
  }

  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();

  if (
    sessionError !== null ||
    session === null ||
    session.user.id !== user.id ||
    session.expires_at === undefined ||
    user.last_sign_in_at === undefined
  ) {
    return null;
  }

  return {
    verified_user_id:
      user.id,
    authenticated_at:
      user.last_sign_in_at,
    expires_at_epoch_seconds:
      session.expires_at,
  };
}

/**
 * Assembles one coherent runtime and trusted context-resolver pair for all
 * CAPA Next.js routes.
 */
export function createCapaApiHandlerDependencies():
  CapaApiHandlerDependencies {
  const selection =
    selectCapaRuntime();

  return {
    get_session_facts:
      getVerifiedSessionFacts,
    resolve_context:
      selection.resolve_context,
    get_runtime() {
      return selection.runtime;
    },
    now() {
      return new Date();
    },
    generate_uuid:
      randomUUID,
    logger: {
      error(message, metadata) {
        console.error(
          message,
          metadata,
        );
      },
    },
  };
}
