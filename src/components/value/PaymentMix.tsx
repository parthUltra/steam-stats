"use client";

/** Steam-blue ramp, strongest first: categories here have no semantic colour. */
const RAMP = [1, 0.62, 0.38, 0.24, 0.16];

/** Payment mix as one segmented bar with its legend inline: as wide as its content. */
export function PaymentMix({
  methods,
  money,
}: {
  methods: { method: string; spent: number; count: number }[];
  money: (n: number) => string;
}) {
  const ordered = [...methods].sort((a, b) => b.spent - a.spent);
  const total = ordered.reduce((s, m) => s + m.spent, 0) || 1;
  const share = (m: { spent: number }) => Math.round((m.spent / total) * 100);
  /** A real but tiny share never prints as 0%. */
  const shareLabel = (m: { spent: number }) =>
    m.spent > 0 && share(m) === 0 ? "<1%" : `${share(m)}%`;
  const shade = (i: number) => RAMP[Math.min(i, RAMP.length - 1)];

  return (
    <div className="v-pay">
      <h4>Payment mix</h4>
      <div
        className="v-pay-bar"
        role="img"
        aria-label={`Payment mix: ${ordered
          .map((m) => `${m.method} ${share(m)} percent`)
          .join(", ")}`}
      >
        {ordered.map((m, i) => (
          <span
            key={m.method}
            style={{
              width: `${(m.spent / total) * 100}%`,
              ["--shade" as string]: shade(i),
            }}
          />
        ))}
      </div>
      <ul className="v-pay-list">
        {ordered.map((m, i) => (
          <li key={m.method}>
            <span
              className="v-pay-dot"
              style={{ ["--shade" as string]: shade(i) }}
              aria-hidden
            />
            <span>{m.method}</span>
            <span className="mono v-strong">{shareLabel(m)}</span>
            <span className="mono v-quiet">
              {money(m.spent)} · {m.count}×
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
