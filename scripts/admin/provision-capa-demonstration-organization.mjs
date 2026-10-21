#!/usr/bin/env node

import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";

const EXPECTED_PROJECT_REF = "cpmvnrirgstpttprjheb";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONFIRMATION = "PROVISION LVTCHAT SYNTHETIC DEMO";

export function getDemonstrationScope(user) {
  const scope = user?.app_metadata?.capa_demo_provisioning;
  if (!scope || typeof scope !== "object" || Array.isArray(scope) || scope.enabled !== true) {
    return null;
  }
  if (!UUID_PATTERN.test(scope.organization_id ?? "") || !UUID_PATTERN.test(scope.target_user_id ?? "")) {
    return null;
  }
  if (typeof scope.organization_name !== "string" || scope.organization_name.trim() !== scope.organization_name || scope.organization_name.length < 1 || scope.organization_name.length > 200) {
    return null;
  }
  if (typeof scope.authorization_policy_version !== "string" || scope.authorization_policy_version.trim() !== scope.authorization_policy_version || scope.authorization_policy_version.length < 1 || scope.authorization_policy_version.length > 100) {
    return null;
  }
  if (scope.target_user_id.toLowerCase() === user.id?.toLowerCase()) return null;
  return Object.freeze({
    organizationId: scope.organization_id.toLowerCase(),
    targetUserId: scope.target_user_id.toLowerCase(),
    organizationName: scope.organization_name,
    authorizationPolicyVersion: scope.authorization_policy_version,
  });
}

export function validateProvisioningResult(data) {
  if (!Array.isArray(data) || data.length !== 1) return null;
  const row = data[0];
  if (!row || typeof row !== "object") return null;
  const ids = [
    row.provisioned_organization_id,
    row.provisioned_membership_id,
    row.owner_role_assignment_id,
    row.administrator_role_assignment_id,
    row.provisioning_audit_event_id,
  ];
  if (!ids.every((id) => typeof id === "string" && UUID_PATTERN.test(id))) return null;
  if (row.provisioned_organization_id.toLowerCase() !== row.provisioned_organization_id) return null;
  return Object.freeze({
    organizationId: row.provisioned_organization_id,
    auditEventId: row.provisioning_audit_event_id,
  });
}

function ask(label) {
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  return terminal.question(label).finally(() => terminal.close());
}

function askHidden(label) {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function") {
    throw new Error("An interactive terminal is required.");
  }
  process.stdout.write(label);
  const priorRawMode = process.stdin.isRaw;
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolve, reject) => {
    let value = "";
    const finish = (error) => {
      process.stdin.off("data", onData);
      process.stdin.setRawMode(priorRawMode ?? false);
      process.stdout.write("\n");
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (chunk) => {
      for (const character of chunk.toString("utf8")) {
        if (character === "\u0003") return finish(new Error("Cancelled."));
        if (character === "\r" || character === "\n") return finish();
        if (character === "\u007f" || character === "\b") value = value.slice(0, -1);
        else if (character >= " ") value += character;
      }
    };
    process.stdin.on("data", onData);
  });
}

async function requireSecondFactor(client, getMfaCode) {
  const { data: assurance, error: assuranceError } = await client.auth.mfa.getAuthenticatorAssuranceLevel();
  if (assuranceError) throw new Error("Operator assurance could not be verified.");
  if (assurance?.currentLevel === "aal2") return;

  const { data: factorData, error: factorError } = await client.auth.mfa.listFactors();
  if (factorError) throw new Error("Operator MFA could not be verified.");
  const factor = factorData?.totp?.find((candidate) => candidate.status === "verified");
  if (!factor) throw new Error("A verified TOTP second factor is required.");

  const { data: challenge, error: challengeError } = await client.auth.mfa.challenge({ factorId: factor.id });
  if (challengeError || !challenge?.id) throw new Error("Operator MFA challenge failed.");
  const code = await getMfaCode();
  const { error: verifyError } = await client.auth.mfa.verify({
    factorId: factor.id,
    challengeId: challenge.id,
    code: code.trim(),
  });
  if (verifyError) throw new Error("Operator MFA verification failed.");

  const { data: verified, error: verifiedError } = await client.auth.mfa.getAuthenticatorAssuranceLevel();
  if (verifiedError || verified?.currentLevel !== "aal2") {
    throw new Error("Second-factor assurance was not established.");
  }
}

export function assertProductionTarget(supabaseUrl) {
  const parsedUrl = new URL(supabaseUrl);
  if (parsedUrl.protocol !== "https:" || parsedUrl.hostname !== `${EXPECTED_PROJECT_REF}.supabase.co`
    || parsedUrl.port || parsedUrl.username || parsedUrl.password
    || parsedUrl.pathname !== "/" || parsedUrl.search || parsedUrl.hash) {
    throw new Error("Configured Supabase project does not match the fixed demonstration target.");
  }
}

// The interactive production command and isolated qualification both call this
// exact Auth, TOTP, identity, and RPC path. Its client is constructed only by
// the respective entrypoint; this function accepts no URL or service key.
export async function provisionWithAuthenticatedOperator({ client, email, password, getMfaCode, authorize }) {
  if (!client || typeof email !== "string" || typeof password !== "string"
    || typeof getMfaCode !== "function" || typeof authorize !== "function") {
    throw new Error("Provisioning inputs are incomplete.");
  }
  try {
    const { error: loginError } = await client.auth.signInWithPassword({ email, password });
    if (loginError) throw new Error("Operator authentication failed.");
    await requireSecondFactor(client, getMfaCode);

    const { data: userData, error: userError } = await client.auth.getUser();
    if (userError || !userData?.user?.id) throw new Error("Verified operator identity is unavailable.");
    const scope = getDemonstrationScope(userData.user);
    if (!scope) throw new Error("This authenticated operator has no valid, scoped demonstration provisioning authorization.");
    if (await authorize(scope) !== true) {
      throw new Error("Confirmation did not match; no provisioning request was sent.");
    }

    const { data, error: rpcError } = await client.rpc("capa_provision_demonstration_organization");
    if (rpcError) throw new Error("The database rejected provisioning or the request could not be completed.");
    const result = validateProvisioningResult(data);
    if (!result || result.organizationId !== scope.organizationId) {
      throw new Error("The provisioning response did not match the authorized scope.");
    }
    return result;
  } finally {
    await client.auth.signOut({ scope: "local" }).catch(() => undefined);
  }
}

async function run() {
  if (process.argv.length !== 2) throw new Error("This command accepts no arguments.");
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("Run this command in a private interactive terminal.");

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) throw new Error("Set the Supabase URL and public anon key in the process environment.");
  assertProductionTarget(supabaseUrl);

  const client = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  const email = (await ask("Provisioning operator email: ")).trim();
  let password = await askHidden("Operator password (hidden): ");
  try {
    const result = await provisionWithAuthenticatedOperator({
      client, email, password,
      getMfaCode: () => ask("Authenticator code: "),
      authorize: async (scope) => {
        process.stdout.write(`\nOne-time operation: create ${scope.organizationName}\n`);
        process.stdout.write("The target Auth user is scoped in server-managed metadata and is checked by the database.\n");
        process.stdout.write("No CAPA case will be created or advanced.\n\n");
        return (await ask(`Type ${CONFIRMATION} to continue: `)).trim() === CONFIRMATION;
      },
    });
    process.stdout.write("Provisioning complete (created or exact idempotent replay).\n");
    process.stdout.write(`Organization UUID: ${result.organizationId}\n`);
    process.stdout.write(`Audit event UUID: ${result.auditEventId}\n`);
  } finally {
    password = "";
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch(() => {
    process.stderr.write("Provisioning stopped. No sensitive error details were printed.\n");
    process.exitCode = 1;
  });
}
