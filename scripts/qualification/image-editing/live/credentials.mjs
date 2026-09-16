const QUALIFICATION_CREDENTIAL_ENV = Object.freeze({
  runware: "RUNWARE_QUAL_API_KEY",
  replicate: "REPLICATE_QUAL_API_TOKEN",
});

function credentialEnvForProvider(provider) {
  const credentialEnv = QUALIFICATION_CREDENTIAL_ENV[provider];
  if (!credentialEnv) throw new Error(`unsupported qualification provider: ${provider}`);
  return credentialEnv;
}

function resolveQualificationCredential(provider, injectedEnvironment = {}) {
  const credentialEnv = credentialEnvForProvider(provider);
  const credential = injectedEnvironment[credentialEnv];
  if (typeof credential !== "string" || credential.trim().length === 0) {
    throw new Error(`missing dedicated qualification credential: ${credentialEnv}`);
  }
  return credential;
}

export { QUALIFICATION_CREDENTIAL_ENV, credentialEnvForProvider, resolveQualificationCredential };
