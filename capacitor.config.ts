import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.lvtchat.app",
  appName: "LVTChat",
  webDir: "capacitor-www",
  server: {
    url: "https://lvtchat.com",
    cleartext: false,
    allowNavigation: ["lvtchat.com"],
  },
  android: {
    allowMixedContent: false,
  },
};

export default config;
