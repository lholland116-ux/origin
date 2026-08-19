import { randomUUID } from "node:crypto";

import {
  handleCapaGet,
  handleCapaPost,
  type CapaApiHandlerDependencies,
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
 * Durable PostgreSQL persistence, server-side Supabase authentication and
 * cryptographic UUID generation require the Node.js runtime.
 */
export const runtime = "nodejs";

/**
 * CAPA responses contain user-specific controlled records and must never
 * be statically cached.
 */
export const dynamic = "force-dynamic";

/**
 * Returns minimized, server-verified authentication facts.
 *
 * Raw access tokens, refresh tokens, provider tokens, passwords, user
 * metadata and browser-supplied authorization values are deliberately
 * excluded from the CAPA application boundary.
 */
async function getVerifiedSessionFacts():
  Promise<
    SupabaseCapaSessionFacts | null
  > {
  const supabase =
    await createServerSupabaseClient();

  /*
   * getUser() validates the authentication token with Supabase and is the
   * authoritative source for the authenticated user identity.
   */
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

  /*
   * The session is read only to obtain minimized expiry information.
   * Credentials and provider data are never passed into CAPA code.
   *
   * Identity remains authoritative only when the session user matches the
   * independently verified getUser() identity.
   */
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
 * Assembles one coherent runtime and trusted context-resolver pair.
 *
 * Production defaults to durable PostgreSQL persistence and durable
 * membership resolution. The in-memory runtime is prohibited in
 * production. Non-production environments retain the development runtime
 * unless CAPA_RUNTIME_MODE=durable is explicitly configured.
 */
function dependencies():
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

export async function POST(
  request: Request,
): Promise<Response> {
  return handleCapaPost(
    request,
    dependencies(),
  );
}

export async function GET(
  request: Request,
): Promise<Response> {
  return handleCapaGet(
    request,
    dependencies(),
  );
}