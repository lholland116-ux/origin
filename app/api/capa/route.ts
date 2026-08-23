import {
  handleCapaGet,
  handleCapaPost,
} from "@/lib/capa/api/capa-route-handler";

import {
  createCapaApiHandlerDependencies,
} from "./capa-next-route-dependencies";

/** Durable CAPA persistence and authentication require Node.js. */
export const runtime = "nodejs";

/** CAPA responses are user-specific and must never be statically cached. */
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
): Promise<Response> {
  return handleCapaPost(
    request,
    createCapaApiHandlerDependencies(),
  );
}

export async function GET(
  request: Request,
): Promise<Response> {
  return handleCapaGet(
    request,
    createCapaApiHandlerDependencies(),
  );
}
