import { handleCapaParticipantsGet } from "../../../../lib/capa/api/capa-participants-route-handler";
import { createCapaApiHandlerDependencies } from "../capa-next-route-dependencies";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return handleCapaParticipantsGet(request, createCapaApiHandlerDependencies());
}
