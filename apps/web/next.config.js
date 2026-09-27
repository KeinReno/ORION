/** @type {import('next').NextConfig} */
const isDesktopExport = process.env.DESKTOP_EXPORT === "1";

const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@orion/core", "@orion/core-react", "@orion/ui", "@orion/shared-types"],
  // O04-follow-up (office editor): `apps/web/lib/office/xlsx-codec.ts`'s
  // modern-xlsx write path now DOES work in the browser for charts/pivot
  // tables — `ensureModernXlsxWasm` branches on `typeof window` and calls
  // modern-xlsx's own `initWasm("/modern-xlsx.wasm")` (a plain `fetch()`,
  // no Node APIs) there, fetching the .wasm copy `copy-modern-xlsx-wasm.mjs`
  // places in public/ before dev/build. This IgnorePlugin is still required
  // though: modern-xlsx's own package internals (`dist/src-*.mjs`,
  // `dist/utils-*.mjs` — the Node-only convenience helpers `wb.toFile()`/
  // `readFile()`, which this codec never calls) reference
  // `node:fs/promises` via dynamic `import()`. Webpack must still *build*
  // (not execute) that reachable-but-unused branch for the client bundle
  // and errors on the bare `node:` scheme without this fallback — it's
  // dead code for our usage, not a live runtime path, so stubbing it out is
  // safe. See docs/SONNET_IMPLEMENTATION/12-PROGRESS.md "O04-follow-up" for
  // the full trail (including why the *original* O04 comment here — that
  // charts/pivots couldn't save from the browser at all — is now stale).
  webpack: (config, { isServer, webpack }) => {
    if (!isServer) {
      config.resolve.fallback = { ...config.resolve.fallback, fs: false, path: false, module: false };
      // `resolve.fallback` only intercepts bare specifiers ("fs"), not the
      // `node:`-scheme requests modern-xlsx actually uses ("node:fs") — that
      // scheme isn't a module id webpack can "fall back" from, it errors
      // before resolution. Stub those requests out entirely for the client
      // bundle instead; see the comment above for why this is safe.
      config.plugins.push(new webpack.IgnorePlugin({ resourceRegExp: /^node:(fs\/promises|fs|path|module)$/ }));
    }
    return config;
  },
  // Separate build output from the dev server's .next/ — running the desktop
  // export build while `next dev` is running previously corrupted the dev
  // server's webpack cache (shared .next dir), crashing the web app.
  ...(isDesktopExport
    ? {
        distDir: ".next-desktop",
        output: "export",
        images: { unoptimized: true }
      }
    : {})
};

module.exports = nextConfig;
