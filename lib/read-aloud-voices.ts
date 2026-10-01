import type { ReadAloudVoicePreference } from "@/lib/read-aloud-preferences";

export function findMatchingReadAloudVoice(
  preference: ReadAloudVoicePreference | null,
  voices: readonly SpeechSynthesisVoice[],
): SpeechSynthesisVoice | null {
  if (preference === null) return null;

  return (
    voices.find(
      (voice) =>
        voice.voiceURI === preference.voiceURI &&
        voice.name === preference.name &&
        voice.lang === preference.lang,
    ) ??
    voices.find((voice) => voice.voiceURI === preference.voiceURI) ??
    null
  );
}
