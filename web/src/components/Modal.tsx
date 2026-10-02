import { useEffect, type ReactNode } from "react";

export function Modal(props: {
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  actions?: ReactNode;
  width?: number;
  zIndex?: number;
  children?: ReactNode;
}) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);
  return (
    <div
      className="modal-back"
      style={props.zIndex ? { zIndex: props.zIndex } : undefined}
      onClick={(e) => e.target === e.currentTarget && props.onClose()}
    >
      <div className="modal" role="dialog" aria-modal="true" style={props.width ? { width: `min(${props.width}px,100%)` } : undefined}>
        <div className="modal-h">
          <div>
            <h3>{props.title}</h3>
            {props.subtitle && <p>{props.subtitle}</p>}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {props.actions}
            <button className="btn ghost sm" type="button" onClick={props.onClose}>
              Close
            </button>
          </div>
        </div>
        {props.children}
      </div>
    </div>
  );
}
