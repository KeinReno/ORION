import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Providers } from "../lib/providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "ORION",
  description: "ORION core"
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
