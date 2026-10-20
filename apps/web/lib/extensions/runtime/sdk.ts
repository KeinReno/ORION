import * as coreReact from "@orion/core-react";
import { PLATFORM_API_VERSION } from "@orion/shared-types";
import * as ui from "@orion/ui";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import * as hostApi from "../host-api";

/**
 * SDK для расширений из папки (ADR-0022, E2). Расширение собирается `orion-ext build` с внешними `react`,
 * `react/jsx-runtime`, `@orion/ui`, `@orion/core-react` и `@orion/sdk` — во время выполнения они берутся отсюда, из
 * `globalThis.__ORION_SDK__`. Поэтому у расширения тот же экземпляр React (хуки работают внутри дерева ORION), те же
 * компоненты и хуки данных, а в его бандле — только его собственный код.
 *
 * `@orion/sdk` — публичная поверхность хоста (`lib/extensions/host-api.ts`), та же, что у плагинов основной сборки:
 * код, перенесённый из расширения в репозиторий (`plugins-ext`), импортирует то же самое.
 */
export interface OrionSdk {
  version: string;
  modules: Record<string, unknown>;
}

declare global {
  var __ORION_SDK__: OrionSdk | undefined;
}

export function installSdk(): OrionSdk {
  if (!globalThis.__ORION_SDK__) {
    globalThis.__ORION_SDK__ = {
      version: PLATFORM_API_VERSION,
      modules: {
        react: React,
        "react/jsx-runtime": jsxRuntime,
        "@orion/ui": ui,
        "@orion/core-react": coreReact,
        "@orion/sdk": hostApi
      }
    };
  }
  return globalThis.__ORION_SDK__;
}
