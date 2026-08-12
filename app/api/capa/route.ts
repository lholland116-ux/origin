import { randomUUID } from "node:crypto";

import {
  handleCapaGet,
  handleCapaPost,
  type CapaApiHandlerDependencies,
} from "@/lib/capa/api/capa-route-handler";

import {
  getCapaDevelopmentRuntime,
} from "@/lib/capa/application/capa-development-runtime";

import type {
  SupabaseCapaSessionFacts,
} from "@/lib/security/supabase-capa-context";

import {
  createServerSupabaseClient,
} from "@/lib/supabase/server";

/**
 * The in-memory CAPA adapter and cryptographic UUID generation require
 * the Node.js runtime.
 */
export const runtime = "nodejs";

/**
 * CAPA responses contain user-specific controlled records and must never
 * be statically cached.
 */
export const dynamic = "force-dynamic";

async function getVerifiedSessionFacts():
  Promise<
    SupabaseCapaSessionFacts | null
  > {
  const supabase =
    await createServerSupabaseClient();

  /*
   * getUser() validates the authentication token with Supabase and is the
   * authoritative source for the user identity.
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
   * Tokens and provider credentials are never passed into CAPA code.
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
    verified_user_id: user.id,
    authenticated_at:
      user.last_sign_in_at,
    expires_at_epoch_seconds:
      session.expires_at,
  };
}

function dependencies():
  CapaApiHandlerDependencies {
  return {
    get_session_facts:
      getVerifiedSessionFacts,

    get_runtime:
      getCapaDevelopmentRuntime,

    now() {
      return new Date();
    },

    generate_uuid:
      randomUUID,

    logger: {
      error(message, metadata) {
        console.error(message, metadata);
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