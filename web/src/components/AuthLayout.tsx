import type { ReactNode } from "react";

export function AuthLayout({ children }: { children?: ReactNode }) {
  return (
    <div className="auth">
      <aside className="auth-brand">
        <div className="auth-brand-logo">
          <img src="/logo.jpg" alt="Westcal" />
        </div>
      </aside>
      <main className="auth-main">
        <div className="auth-card">
          <img src="/logo.jpg" alt="Westcal" className="auth-card-logo" />
          {children}
        </div>
      </main>
    </div>
  );
}
