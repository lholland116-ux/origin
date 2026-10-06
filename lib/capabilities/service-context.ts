import { z } from "zod";

const uuidSchema = z.uuid();

export const CapabilityResourceReferenceSchema = z.object({
  id: uuidSchema,
  kind: z.enum(["file", "image", "artifact"]),
}).strict();

const attachmentReferenceSchema = z.object({ id: uuidSchema, kind: z.literal("file") }).strict();
const imageReferenceSchema = z.object({ id: uuidSchema, kind: z.literal("image") }).strict();
const artifactReferenceSchema = z.object({ id: uuidSchema, kind: z.literal("artifact") }).strict();

const commonContextShape = {
  userId: uuidSchema,
  attachmentRefs: z.array(attachmentReferenceSchema).optional(),
  imageRefs: z.array(imageReferenceSchema).optional(),
  artifactRefs: z.array(artifactReferenceSchema).optional(),
  reasoningMode: z.enum(["instant", "medium", "high"]).optional(),
  requestId: z.string().min(1).max(200).optional(),
};

/**
 * Construct this only after HTTP authentication; it contains no request/client
 * objects. A successful conversational Standard/Web call is a chat turn bound
 * to a persisted conversation; the extracted shared application service owns
 * its user/assistant message persistence. An execution call is not impersonated
 * as a chat message; any future non-chat result uses a distinct execution-result
 * persistence path.
 */
export const CapabilityServiceContextSchema = z.discriminatedUnion("kind", [
  z.object({
    ...commonContextShape,
    kind: z.literal("conversation"),
    conversationId: uuidSchema,
  }).strict(),
  z.object({
    ...commonContextShape,
    kind: z.literal("execution"),
  }).strict(),
]);

export type CapabilityResourceReference = z.infer<typeof CapabilityResourceReferenceSchema>;
export type CapabilityServiceContext = z.infer<typeof CapabilityServiceContextSchema>;

export function parseCapabilityServiceContext(input: unknown) {
  return CapabilityServiceContextSchema.safeParse(input);
}
