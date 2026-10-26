import type { MobileSettings } from "@orion/mobile-core";
export interface SettingControlProps {
  settings: MobileSettings;
  pending: Partial<Record<keyof MobileSettings, boolean>>;
  patch: (change: Partial<MobileSettings>) => Promise<boolean>;
}
