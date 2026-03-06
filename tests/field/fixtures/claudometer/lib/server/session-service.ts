export async function getSessionDetail(sessionId: string) {
  return {
    id: sessionId,
    participants: await loadSessionParticipants(sessionId),
  };
}

export async function loadSessionParticipants(_sessionId: string) {
  return ["agent", "reviewer"];
}
