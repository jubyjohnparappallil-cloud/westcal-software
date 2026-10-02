import { useEffect, useState, type ReactNode } from "react";

const PAGE_SIZE = 10;

export function usePaged<T>(items: T[], resetKey: unknown = null, size = PAGE_SIZE) {
  const [page, setPage] = useState(1);
  const pages = Math.max(1, Math.ceil(items.length / size));
  useEffect(() => setPage(1), [resetKey]);
  const current = Math.min(page, pages);
  return {
    page: current,
    pages,
    setPage,
    total: items.length,
    size,
    rows: items.slice((current - 1) * size, current * size),
  };
}

export function Paged<T>({
  items,
  resetKey = null,
  size = PAGE_SIZE,
  children,
}: {
  items: T[];
  resetKey?: unknown;
  size?: number;
  children: (rows: T[], offset: number) => ReactNode;
}) {
  const p = usePaged(items, resetKey, size);
  return (
    <>
      {children(p.rows, (p.page - 1) * p.size)}
      <Pagination {...p} />
    </>
  );
}

function pageList(page: number, pages: number): (number | "…")[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const out: (number | "…")[] = [1];
  const from = Math.max(2, page - 1);
  const to = Math.min(pages - 1, page + 1);
  if (from > 2) out.push("…");
  for (let i = from; i <= to; i++) out.push(i);
  if (to < pages - 1) out.push("…");
  out.push(pages);
  return out;
}

export function Pagination({
  page,
  pages,
  total,
  size,
  setPage,
}: {
  page: number;
  pages: number;
  total: number;
  size: number;
  setPage: (p: number) => void;
}) {
  if (total <= size) return null;
  const first = (page - 1) * size + 1;
  const last = Math.min(total, page * size);
  return (
    <div className="pager">
      <span className="muted">
        Showing {first}–{last} of {total}
      </span>
      <div className="pager-btns">
        <button disabled={page === 1} onClick={() => setPage(page - 1)}>
          ‹ Prev
        </button>
        {pageList(page, pages).map((n, i) =>
          n === "…" ? (
            <span key={"gap" + i} className="gap">
              …
            </span>
          ) : (
            <button key={n} className={n === page ? "on" : ""} onClick={() => setPage(n)}>
              {n}
            </button>
          ),
        )}
        <button disabled={page === pages} onClick={() => setPage(page + 1)}>
          Next ›
        </button>
      </div>
    </div>
  );
}
