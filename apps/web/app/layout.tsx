import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Providers } from "../lib/providers";
import { RuntimeReady } from "../lib/runtime-ready";
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
        <script
          type="text/html"
          id="orion-direction-contract"
          dangerouslySetInnerHTML={{
            __html: `<!--
THESIS: A non-linear editing suite for many life domains; docked work persists instead of becoming a generic card dashboard.
OWN-WORLD: Graphite, bone text, user-theme accent, 1px seams, compact grotesque, mono timecode, square transport controls, registered tracks.
STORY: Capture first, then scan focus, schedule and records without losing workspace context.
FIRST VIEWPORT: 60px rail; persistent context; compact panel header; full-width command strip; aligned focus/today tracks; primary action at header right.
FORM: Professional NLE, grounded candidate 6, seed cefcc80a. Hold-state keeps row identity. Typographic rank uses weight/case/rules. Registered plates share baselines. Cells reflow whole.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
-->`
          }}
        />
        <Providers>{children}</Providers>
        <RuntimeReady />
      </body>
    </html>
  );
}
