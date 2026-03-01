import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "AB Calicritters Dashboard",
  description: "Experiment analytics dashboard",
};

export default function RootLayout({ children }: { children: ReactNode }): ReactNode {
  return (
    <html lang="en">
      <body>
        <div className="shell">
          <header className="topbar">
            <h1>AB Calicritters Dashboard</h1>
            <nav className="nav">
              <a href="/overview">Overview</a>
              <a href="/experiments">Experiments</a>
              <a href="/ingestion">Ingestion</a>
              <a href="/benchmarks">Benchmarks</a>
            </nav>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
