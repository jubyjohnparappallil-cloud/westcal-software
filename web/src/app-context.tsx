import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, setApiToken } from "./api";
import { permissions, type Permissions } from "./permissions";
import type { Course, Session } from "./types";

export type View = string;

export interface NavState {
  view: View;
  jobService: string;
  trainingTab: string;
  certTab: string;
  reportStatus: string;
  jobId: string;
}

interface AppValue {
  session: Session;
  perms: Permissions;
  courses: Course[];
  setCourses: (c: Course[]) => void;
  nav: NavState;
  go: (view: View, patch?: Partial<NavState>) => void;
  openService: (service: string) => void;
  openJob: (service: string, jobId: string) => void;
  goToCertificates: (tab?: string) => void;
  goToReports: (status?: string) => void;
  signOut: () => void;
}

const Ctx = createContext<AppValue | null>(null);

export function useApp(): AppValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp must be used inside AppProvider");
  return v;
}

const PERM_REFRESH_MS = 60000;

export function AppProvider(props: { session: Session; initialCourses: Course[]; onSignOut: () => void; children: ReactNode }) {
  const [session, setSession] = useState(props.session);
  const [courses, setCourses] = useState(props.initialCourses);
  const [nav, setNav] = useState<NavState>({
    view: "dashboard",
    jobService: "Training",
    trainingTab: "jobs",
    certTab: "pending",
    reportStatus: "all",
    jobId: "",
  });
  const lastRefresh = useRef(Date.now());
  const refreshPerms = useCallback(() => {
    if (Date.now() - lastRefresh.current < PERM_REFRESH_MS) return;
    lastRefresh.current = Date.now();
    api<Session>("GET", "/api/me")
      .then((me) => setSession((s) => ({ ...s, perms: me.perms || [], roles: me.roles || s.roles, modules: me.modules ?? null })))
      .catch(() => {});
  }, []);
  const go = useCallback(
    (view: View, patch?: Partial<NavState>) => {
      setNav((n) => ({ ...n, jobId: "", ...patch, view }));
      refreshPerms();
    },
    [refreshPerms],
  );
  const value = useMemo<AppValue>(
    () => ({
      session,
      perms: permissions(session),
      courses,
      setCourses,
      nav,
      go,
      openService: (service) => go("jobs", { jobService: service, trainingTab: "jobs" }),
      openJob: (service, jobId) => go("jobs", { jobService: service, trainingTab: "jobs", jobId }),
      goToCertificates: (tab) => go("approvals", { certTab: tab || "pending" }),
      goToReports: (status) => go("reports", status ? { reportStatus: status } : undefined),
      signOut: () => {
        setApiToken(null);
        props.onSignOut();
      },
    }),
    [session, courses, nav, go, props.onSignOut],
  );
  return <Ctx.Provider value={value}>{props.children}</Ctx.Provider>;
}

/** Loads data for a page; keeps the old data visible while reloading. */
export function usePageData<T>(load: () => Promise<T>, deps: unknown[] = []) {
  const [state, setState] = useState<{ loading: boolean; data: T | null; error: string }>({ loading: true, data: null, error: "" });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setState((s) => ({ ...s, loading: s.data === null, error: "" }));
    load()
      .then((data) => live && setState({ loading: false, data, error: "" }))
      .catch((e: Error) => live && setState({ loading: false, data: null, error: e.message }));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { ...state, reload: () => setTick((t) => t + 1) };
}
