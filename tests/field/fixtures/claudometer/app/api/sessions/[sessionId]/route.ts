import { getSessionDetail } from "../../../../lib/server/session-service";

export async function GET() {
  return getSessionDetail("session_123");
}
