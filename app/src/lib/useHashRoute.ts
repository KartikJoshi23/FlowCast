import { useEffect, useState } from "react";

const parse = (hash: string) => hash.replace(/^#\/?/, "").split(/[?#]/)[0] || "";

/** Minimal hash router: "#/forecast" -> "forecast" (empty string for the home route). */
export function useHashRoute(): string {
  const [route, setRoute] = useState(() => parse(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parse(window.location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}
