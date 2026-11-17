import { useEffect, useState } from "react";

export function navigate(to: string, replace = false) {
  if (replace) history.replaceState(null, "", to);
  else history.pushState(null, "", to);
  window.dispatchEvent(new PopStateEvent("popstate"));
  window.scrollTo(0, 0);
}

export function useLocation() {
  const [loc, setLoc] = useState(() => ({ path: location.pathname, search: location.search }));
  useEffect(() => {
    const onChange = () => setLoc({ path: location.pathname, search: location.search });
    window.addEventListener("popstate", onChange);
    return () => window.removeEventListener("popstate", onChange);
  }, []);
  return loc;
}

/** Matches "/shows/{showId}" style patterns. Returns params or null. */
export function match(pattern: string, path: string): Record<string, string> | null {
  const names: string[] = [];
  const re = new RegExp(
    `^${pattern.replace(/\{(\w+)\}/g, (_, n: string) => {
      names.push(n);
      return "([^/]+)";
    })}/?$`,
  );
  const m = re.exec(path);
  return m ? Object.fromEntries(names.map((n, i) => [n, decodeURIComponent(m[i + 1]!)])) : null;
}

export function Link(props: {
  to: string;
  children: React.ReactNode;
  className?: string;
  current?: boolean;
  style?: React.CSSProperties;
  "aria-label"?: string;
}) {
  return (
    <a
      href={props.to}
      className={props.className}
      style={props.style}
      aria-label={props["aria-label"]}
      aria-current={props.current ? "page" : undefined}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        navigate(props.to);
      }}
    >
      {props.children}
    </a>
  );
}
