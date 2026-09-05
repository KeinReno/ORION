/** @type {import('next').NextConfig} */
const isDesktopExport = process.env.DESKTOP_EXPORT === "1";

const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@orion/core", "@orion/core-react", "@orion/ui", "@orion/shared-types"],
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
