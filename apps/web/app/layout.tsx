import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Providers } from "../lib/providers";
import "@orion/ui/src/theme.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "ORION",
  description: "ORION core",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/kaiden-16.png", sizes: "16x16", type: "image/png" },
      { url: "/kaiden-32.png", sizes: "32x32", type: "image/png" },
      { url: "/kaiden-192.png", sizes: "192x192", type: "image/png" },
      { url: "/kaiden-512.png", sizes: "512x512", type: "image/png" }
    ],
    apple: [{ url: "/kaiden-180.png", sizes: "180x180", type: "image/png" }]
  }
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#0d0d11"
};

export default function RootLayout({ children }: { children: ReactNode }): React.ReactElement {
  return (
    <html lang="ru">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
