import { randomUUID } from "node:crypto";

import {
  handleCapaGet,
  handleCapaPost,
  type CapaApiHandlerDependencies,
} from "@/lib/capa/api/capa-route-handler";

import {
  getCapaDevelopmentRuntime,
} from "@/lib/capa/application/capa-development-runtime";

import {
  resolveDevelopmentCapaRequestContext,
  type SupabaseCapaSessionFacts,
} from "@/lib/security/supabase-capa-context";

import {
  createServerSupabaseClient,
} from "@/lib/supabase/server";

/**
 * The CAPA runtime, server-side Supabase authentication, and
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
 * metadata, and browser-supplied authorization values are deliberately
 * excluded from the CAPA application boundary.
 */
async function getVerifiedSessionFacts():
  Promise<
    SupabaseCapaSessionFacts | null
  > {
  const supabase =
    await createServerSupabaseClient();

  /*
   * getUser() verifies the authentication token with Supabase and is the
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
 * Assembles the current CAPA API dependencies.
 *
 * The development resolver and in-memory runtime remain explicit here
 * during the controlled transition to durable persistence. Both fail
 * closed in production and will be replaced together by the durable
 * runtime and database-backed tenant resolver.
 */
function dependencies():
  CapaApiHandlerDependencies {
  return {
    get_session_facts:
      getVerifiedSessionFacts,

    resolve_context:
      resolveDevelopmentCapaRequestContext,

    get_runtime:
      getCapaDevelopmentRuntime,

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