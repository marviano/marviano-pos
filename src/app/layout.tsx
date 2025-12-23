import type { Metadata } from "next";
import "./globals.css";
import WindowFocusHandler from "@/components/WindowFocusHandler";
import ServiceWorkerErrorHandler from "@/components/ServiceWorkerErrorHandler";

export const metadata: Metadata = {
  title: "Marviano POS",
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
        {children}
      </body>
    </html>
  );
}
