import type { ReactNode } from "react";
import type { Facts } from "../data/types";
import { fmtMonth } from "../lib/format";
import type { InterpretationSource } from "../llm/interpretationStore";
import { IconAlert, IconCheck, IconSpark } from "./icons";
import { StatusPill } from "./ui";

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Renders text with any unverified figures highlighted (so an invented number cannot hide). */
export function HighlightedText({ text, unverified }: { text: string; unverified: string[] }) {
  if (!unverified.length) return <>{text}</>;
  const pattern = new RegExp(`(${[...new Set(unverified)].map(escapeRegExp).join("|")})`, "g");
  const parts = text.split(pattern);
  return (
    <>
      {parts.map((part, i) =>
        unverified.includes(part) ? (
          <mark key={i} title="This figure could not be found in the facts" className="rounded bg-warning/20 px-0.5 text-warning">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

/** Value at a dotted facts path ("models.naive.test.wape_pct", "ranking.0.label"). */
export function factAt(facts: Facts, path: string): unknown {
  let node: unknown = facts;
  for (const part of path.split(".")) {
    if (node && typeof node === "object") node = (node as Record<string, unknown>)[part];
    else return undefined;
  }
  return node;
}

function describe(value: unknown): string {
  if (value === undefined) return "not in facts";
  if (value === null) return "n/a";
  if (Array.isArray(value)) {
    const items = value.map((v) =>
      v && typeof v === "object"
        ? Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== null && typeof x !== "object").map(([, x]) => String(x)).join(" ")
        : String(v),
    );
    const text = items.join("; ");
    return text.length > 140 ? `${text.slice(0, 137)}…` : text;
  }
  if (typeof value === "object") return "{…}";
  return String(value);
}

/** The facts an answer cites, with their actual values. */
export function EvidenceList({ keys, facts }: { keys: string[]; facts: Facts }) {
  if (!keys.length) return null;
  return (
    <details className="group mt-3 text-[12px]">
      <summary className="cursor-pointer list-none text-ink-3 transition-colors hover:text-ink-2">
        <span className="inline-block transition-transform group-open:rotate-90">›</span> Facts used ({keys.length})
      </summary>
      <ul className="mt-2 space-y-1 border-l hairline pl-3">
        {[...new Set(keys)].map((key) => (
          <li key={key} className="flex flex-wrap gap-x-2">
            <code className="text-ink-3">{key}</code>
            <span className="tabular text-ink-1">{describe(factAt(facts, key))}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

export function SourceBadge({ source }: { source: InterpretationSource | null }) {
  if (!source) return null;
  if (source.kind === "llm") {
    return (
      <StatusPill tone="busy" icon={<IconSpark size={13} />} title={source.cached ? "Served from cache: identical facts were interpreted before." : undefined}>
        LLM · {source.model}{source.cached ? " · cached" : ""}
      </StatusPill>
    );
  }
  return (
    <StatusPill tone="neutral" icon={<IconAlert size={13} />} title={source.reason}>
      Rule-based interpretation (LLM unavailable)
    </StatusPill>
  );
}

export function GroundingBadge({ checked, unverified, badKeys }: { checked: number; unverified: string[]; badKeys: string[] }) {
  if (!unverified.length && !badKeys.length) {
    return (
      <StatusPill tone="good" icon={<IconCheck size={13} />}>
        All {checked} figures verified against the facts
      </StatusPill>
    );
  }
  return (
    <StatusPill tone="warning" icon={<IconAlert size={13} />} title={[...unverified, ...badKeys].join(", ")}>
      {unverified.length} figure{unverified.length === 1 ? "" : "s"} unverified{badKeys.length ? ` · ${badKeys.length} unknown fact key(s)` : ""}
    </StatusPill>
  );
}

export function BasisLine({ basis, generatedAt, children }: { basis: { dataThrough: string; months: number; level: string } | null; generatedAt: string | null; children?: ReactNode }) {
  if (!basis) return null;
  const time = generatedAt ? new Date(generatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : null;
  return (
    <p className="text-[12.5px] text-ink-3">
      Based on data through <strong className="text-ink-2">{fmtMonth(basis.dataThrough)}</strong> ({basis.months} months) · {basis.level}
      {time && <> · generated {time}</>}
      {children}
    </p>
  );
}
