import { Capacitor } from "@capacitor/core";
import type {
  SpeechSynthesisVoice as NativeSpeechSynthesisVoice,
  TextToSpeechPlugin,
  TTSOptions,
} from "@capacitor-community/text-to-speech";
import type { ReadAloudPreferences } from "@/lib/read-aloud-preferences";
import { findMatchingReadAloudVoice } from "@/lib/read-aloud-voices";

type NativeTextToSpeechModule = {
  readonly TextToSpeech: TextToSpeechPlugin;
  readonly QueueStrategy: { readonly Flush: number };
};

const nativeVoiceListeners = new Set<
  (voices: readonly SpeechSynthesisVoice[]) => void
>();
let nativeVoices: SpeechSynthesisVoice[] = [];
let nativeOperationId = 0;

async function loadNativeTextToSpeech(): Promise<NativeTextToSpeechModule> {
  return import("@capacitor-community/text-to-speech");
}

function notifyNativeVoiceListeners(): void {
  const snapshot = [...nativeVoices];
  nativeVoiceListeners.forEach((listener) => listener(snapshot));
}

export function isNativeAndroidReadAloudRuntime(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
}

export function isNativeAndroidReadAloudAvailable(): boolean {
  return (
    isNativeAndroidReadAloudRuntime() &&
    Capacitor.isPluginAvailable("TextToSpeech")
  );
}

export function mapNativeReadAloudVoice(
  voice: NativeSpeechSynthesisVoice,
): SpeechSynthesisVoice {
  return {
    voiceURI: voice.voiceURI,
    name: voice.name,
    lang: voice.lang,
    localService: voice.localService,
    default: voice.default,
  };
}

export function getCachedNativeReadAloudVoices(): SpeechSynthesisVoice[] {
  return [...nativeVoices];
}

export async function refreshNativeReadAloudVoices(): Promise<
  SpeechSynthesisVoice[]
> {
  try {
    const { TextToSpeech } = await loadNativeTextToSpeech();
    const result = await TextToSpeech.getSupportedVoices();
    nativeVoices = result.voices.map(mapNativeReadAloudVoice);
  } catch {
    nativeVoices = [];
  }

  notifyNativeVoiceListeners();
  return [...nativeVoices];
}

export function subscribeToNativeReadAloudVoices(
  listener: (voices: readonly SpeechSynthesisVoice[]) => void,
): () => void {
  nativeVoiceListeners.add(listener);
  listener(getCachedNativeReadAloudVoices());
  void refreshNativeReadAloudVoices();
  return () => nativeVoiceListeners.delete(listener);
}

function nativeSpeakOptions(
  text: string,
  preferences: ReadAloudPreferences,
  voices: readonly SpeechSynthesisVoice[],
  queueStrategy: number,
): TTSOptions {
  const matchedVoice = findMatchingReadAloudVoice(preferences.voice, voices);
  const voiceIndex = matchedVoice === null ? -1 : voices.indexOf(matchedVoice);
  const options: TTSOptions = {
    text,
    rate: preferences.rate,
    pitch: 1,
    volume: 1,
    queueStrategy,
  };

  if (voiceIndex >= 0 && matchedVoice) {
    options.voice = voiceIndex;
    options.lang = matchedVoice.lang;
  }

  return options;
}

export function startNativeReadAloud(
  text: string,
  preferences: ReadAloudPreferences,
  onFinish: () => void,
): void {
  const operationId = ++nativeOperationId;

  void (async () => {
    try {
      const ttsModule = await loadNativeTextToSpeech();
      try {
        await ttsModule.TextToSpeech.stop();
      } catch {
        // A first-use stop may fail while Android TTS initializes; speaking can still succeed.
      }
      if (operationId !== nativeOperationId) return;

      let voices: SpeechSynthesisVoice[];
      try {
        const result = await ttsModule.TextToSpeech.getSupportedVoices();
        voices = result.voices.map(mapNativeReadAloudVoice);
        nativeVoices = voices;
        notifyNativeVoiceListeners();
      } catch {
        voices = [];
        nativeVoices = [];
        notifyNativeVoiceListeners();
      }
      if (operationId !== nativeOperationId) return;

      await ttsModule.TextToSpeech.speak(
        nativeSpeakOptions(
          text,
          preferences,
          voices,
          ttsModule.QueueStrategy.Flush,
        ),
      );
    } catch {
      // Native TTS errors are nonfatal and finish the active Read Aloud operation.
    }

    if (operationId === nativeOperationId) onFinish();
  })();
}

export function stopNativeReadAloud(): void {
  nativeOperationId += 1;
  void loadNativeTextToSpeech()
    .then(({ TextToSpeech }) => TextToSpeech.stop())
    .catch(() => undefined);
}
