import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Providers } from "../lib/providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "ORION",
  description: "ORION core"
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
