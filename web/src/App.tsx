import { lazy, Suspense, useCallback, useState, useEffect } from "react";
import { AppProvider } from "./app-context";
import { Shell } from "./Shell";
import { Register } from "./pages/Register";
import { SignIn } from "./pages/SignIn";
import { api, setApiToken } from "./api";
import { permissions } from "./permissions";
import type { Course, Session } from "./types";
import "./styles.css";

const SESSION_CACHE = "westcal-office-session";
const FieldScreen = lazy(() =>
  Promise.all([import("./field/FieldApp"), import("./field/field.css")]).then(([m]) => ({ default: m.FieldApp })),
);

export function App() {
  const [signedIn, setSignedIn] = useState<{ session: Session; courses: Course[] } | null>(() => {
    try {
      const token = localStorage.getItem("token") || sessionStorage.getItem("token");
      const raw = sessionStorage.getItem(SESSION_CACHE);
      if (token && raw) return JSON.parse(raw) as { session: Session; courses: Course[] };
    } catch {
      /* start from the network */
    }
    return null;
  });
  const [screen, setScreen] = useState<{ name: "signin"; user?: string } | { name: "register" }>({ name: "signin" });
  const [loading, setLoading] = useState(() => {
    const token = localStorage.getItem("token") || sessionStorage.getItem("token");
    return !!token && !signedIn;
  });
  const signOut = useCallback(() => {
    setApiToken(null);
    try {
      sessionStorage.removeItem(SESSION_CACHE);
    } catch {
      /* ignore */
    }
    setSignedIn(null);
  }, []);

  useEffect(() => {
    const token = localStorage.getItem("token") || sessionStorage.getItem("token");
    if (!token) {
      setLoading(false);
      return;
    }
    Promise.all([api<Omit<Session, "token">>("GET", "/api/me"), api<Course[]>("GET", "/api/courses")])
      .then(([me, courses]) => {
        const session = { ...me, token } as Session;
        const next = { session, courses };
        try {
          sessionStorage.setItem(SESSION_CACHE, JSON.stringify(next));
        } catch {
          /* quota */
        }
        setSignedIn(next);
        setLoading(false);
      })
      .catch(() => {
        setApiToken(null);
        try {
          sessionStorage.removeItem(SESSION_CACHE);
        } catch {
          /* ignore */
        }
        setSignedIn(null);
        setLoading(false);
      });
  }, []);

  if (loading) return <div className="loading">Loading...</div>;

  if (signedIn) {
    const p = permissions(signedIn.session);
    if (p.isFieldUser() && !p.isAdmin()) {
      return (
        <Suspense fallback={<div className="loading">Loading...</div>}>
          <FieldScreen initialSession={signedIn.session} onSignOut={signOut} />
        </Suspense>
      );
    }
  }

  if (!signedIn) {
    if (screen.name === "register")
      return <Register onBack={() => setScreen({ name: "signin" })} onRegistered={(user) => setScreen({ name: "signin", user })} />;
    return (
      <SignIn
        key={screen.user ?? ""}
        initialUser={screen.user}
        onRegister={() => setScreen({ name: "register" })}
        onSignedIn={(session, courses) => {
          const next = { session, courses };
          try {
            sessionStorage.setItem(SESSION_CACHE, JSON.stringify(next));
          } catch {
            /* quota */
          }
          setSignedIn(next);
        }}
      />
    );
  }
  return (
    <AppProvider session={signedIn.session} initialCourses={signedIn.courses} onSignOut={signOut}>
      <Shell />
    </AppProvider>
  );
}
