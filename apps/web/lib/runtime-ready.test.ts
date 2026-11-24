import { afterEach, expect, it, vi } from "vitest";
import { RuntimeReady } from "./runtime-ready";

const effects = vi.hoisted(() => ({ cleanup: undefined as (() => void) | undefined }));
vi.mock("react", () => ({
  useEffect: (effect: () => (() => void) | undefined) => {
    effects.cleanup = effect();
  }
}));

afterEach(() => {
  effects.cleanup?.();
  effects.cleanup = undefined;
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it("retries a successful HTTP response until the API accepts the payload acknowledgement", async () => {
  vi.useFakeTimers();
  vi.stubEnv("NEXT_PUBLIC_ORION_BUILD_TAG", "v0.2.9");
  vi.stubGlobal("location", { protocol: "http:", hostname: "tauri.localhost" });
  const fetch = vi.fn()
    .mockResolvedValueOnce(Response.json({ accepted: false }))
    .mockResolvedValueOnce(Response.json({ accepted: true }));
  vi.stubGlobal("fetch", fetch);

  RuntimeReady();
  await vi.advanceTimersByTimeAsync(0);
  expect(fetch).toHaveBeenCalledTimes(1);

  await vi.advanceTimersByTimeAsync(3_000);
  expect(fetch).toHaveBeenCalledTimes(2);

  await vi.advanceTimersByTimeAsync(6_000);
  expect(fetch).toHaveBeenCalledTimes(2);
});
