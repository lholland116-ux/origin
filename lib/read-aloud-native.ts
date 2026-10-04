import { Capacitor } from "@capacitor/core";
import type { TextToSpeechPlugin, TTSOptions } from "@capacitor-community/text-to-speech";
import type { ReadAloudPreferences } from "@/lib/read-aloud-preferences";

type NativeTextToSpeechModule = {
  readonly TextToSpeech: TextToSpeechPlugin;
  readonly QueueStrategy: { readonly Flush: number };
};

let nativeOperationId = 0;

async function loadNativeTextToSpeech(): Promise<NativeTextToSpeechModule> {
  return import("@capacitor-community/text-to-speech");
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

function nativeSpeakOptions(
  text: string,
  preferences: ReadAloudPreferences,
  queueStrategy: number,
): TTSOptions {
  return {
    text,
    rate: preferences.rate,
    pitch: 1,
    volume: 1,
    queueStrategy,
  };
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

      await ttsModule.TextToSpeech.speak(
        nativeSpeakOptions(
          text,
          preferences,
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
