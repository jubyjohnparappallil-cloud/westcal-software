import { useCallback, useState, useEffect } from "react";
import { AppProvider } from "./app-context";
import { Shell } from "./Shell";
import { Register } from "./pages/Register";
import { SignIn } from "./pages/SignIn";
import { api, setApiToken } from "./api";
import { permissions } from "./permissions";
import type { Course, Session } from "./types";
import "./styles.css";

export function App() {
  const [signedIn, setSignedIn] = useState<{ session: Session; courses: Course[] } | null>(null);
  const [screen, setScreen] = useState<{ name: "signin"; user?: string } | { name: "register" }>({ name: "signin" });
  const [loading, setLoading] = useState(true);
  const signOut = useCallback(() => {
    setApiToken(null);
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
        const p = permissions(session);
        if (p.isFieldUser() && !p.isAdmin()) {
          location.href = "/m";
          return;
        }
        setSignedIn({ session, courses });
        setLoading(false);
      })
      .catch(() => {
        setApiToken(null);
        setLoading(false);
      });
  }, []);

  if (loading) return <div className="loading">Loading...</div>;

  if (!signedIn) {
    if (screen.name === "register")
      return <Register onBack={() => setScreen({ name: "signin" })} onRegistered={(user) => setScreen({ name: "signin", user })} />;
    return (
      <SignIn
        key={screen.user ?? ""}
        initialUser={screen.user}
        onRegister={() => setScreen({ name: "register" })}
        onSignedIn={(session, courses) => setSignedIn({ session, courses })}
      />
    );
  }
  return (
    <AppProvider session={signedIn.session} initialCourses={signedIn.courses} onSignOut={signOut}>
      <Shell />
    </AppProvider>
  );
}
