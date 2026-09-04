/** @type {import('next').NextConfig} */
const isDesktopExport = process.env.DESKTOP_EXPORT === "1";

const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@orion/core", "@orion/core-react", "@orion/ui", "@orion/shared-types"],
  ...(isDesktopExport
    ? {
        output: "export",
        images: { unoptimized: true }
      }
    : {})
};

module.exports = nextConfig;
