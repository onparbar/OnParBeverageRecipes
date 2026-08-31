import Script from "next/script";
import "./globals.css";
import "./identity.css";

export const metadata = {
  title: "On Par Beverage Dashboard",
  description: "Beverage costing and inventory dashboard for On Par.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>
        {children}
        <Script src="/dashboard-identity.js" strategy="afterInteractive" />
      </body>
    </html>
  );
}
