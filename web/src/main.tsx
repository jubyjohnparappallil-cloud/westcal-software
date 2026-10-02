import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

const path = location.pathname.replace(/^\/app(?=\/|$)/, "") || "/";
const join = path.match(/^\/join\/([^/]+)(?:\/([^/]+))?\/?$/);
const field = /^\/(m|mobile)\/?$/.test(path);

async function boot(): Promise<ReactNode> {
  if (join) {
    const { TraineeJoin } = await import("./pages/public/TraineeJoin");
    return <TraineeJoin token={join[1]} editToken={join[2] || ""} />;
  }
  if (field) {
    const [{ FieldApp }] = await Promise.all([import("./field/FieldApp"), import("./field/field.css")]);
    return <FieldApp />;
  }
  const { App } = await import("./App");
  return <App />;
}

boot().then((node) => createRoot(document.getElementById("root")!).render(<StrictMode>{node}</StrictMode>));
