import type { CapacitorConfig } from "@capacitor/cli";
const config: CapacitorConfig = {
  appId: "io.kaiden.orion.android",
  appName: "KAIDEN Orion",
  webDir: "dist",
  android: { allowMixedContent: false },
};
export default config;
