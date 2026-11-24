import "./globals.css";
import "./identity.css";
import "./recipe-guide.css";

export const metadata = {
  title: "On Par Beverage Dashboard",
  description: "Beverage costing and inventory dashboard for On Par.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
