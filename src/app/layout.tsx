import type { Metadata } from "next";
import "./globals.css";
import WindowFocusHandler from "@/components/WindowFocusHandler";
import ServiceWorkerErrorHandler from "@/components/ServiceWorkerErrorHandler";
import DisableHMR from "@/components/DisableHMR";
import { AppDialogProvider } from "@/components/AppDialog";

export const metadata: Metadata = {
  title: "POS",
  description: "Point of Sale System",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="overflow-hidden">
      <body
        className={`antialiased overflow-hidden font-sans`}
      >
        <WindowFocusHandler />
        <ServiceWorkerErrorHandler />
        <DisableHMR />
        <AppDialogProvider>
          {children}
        </AppDialogProvider>
      </body>
    </html>
  );
}
