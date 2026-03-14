export function SessionStats({ total, active }: { total: number; active: number }) {
  const ratio = total > 0 ? active / total : 0;
  return (
    <div>
      <h2>Stats &amp; Overview</h2>
      <p>{total} total &amp; {active} active sessions</p>
      <span>{ratio > 0.5 ? "healthy" : "degraded"}</span>
    </div>
  );
}
