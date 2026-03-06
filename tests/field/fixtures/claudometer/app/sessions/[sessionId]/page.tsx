import { SessionHeader } from "../../../components/SessionHeader";
import { SessionTabs } from "../../../components/SessionTabs";
import { SessionTimeline } from "../../../components/SessionTimeline";
import { loadSessionDetail } from "../../../lib/client/session-api";

export async function SessionDetailPage({
  params,
}: {
  params: { sessionId: string };
}) {
  await loadSessionDetail(params.sessionId);

  return (
    <section>
      <SessionHeader />
      <SessionTabs />
      <SessionTimeline />
    </section>
  );
}
