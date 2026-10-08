import { APIConnectionError, APIConnectionTimeoutError } from "openai";
import { describe, expect, it } from "vitest";
import { isTemporaryProviderDnsFailure } from "@/lib/ai/provider-failure-normalization";

describe("provider failure normalization", () => {
  it("recognizes only connection errors caused by DNS EAI_AGAIN", () => {
    const dnsCause = Object.assign(new Error("private resolver detail"), { code: "EAI_AGAIN" });
    expect(isTemporaryProviderDnsFailure(new APIConnectionError({ cause: dnsCause }))).toBe(true);
    expect(isTemporaryProviderDnsFailure(new APIConnectionError({ cause: new Error("socket reset") }))).toBe(false);
    expect(isTemporaryProviderDnsFailure(new APIConnectionTimeoutError())).toBe(false);
    expect(isTemporaryProviderDnsFailure(new Error("EAI_AGAIN"))).toBe(false);
  });
});
