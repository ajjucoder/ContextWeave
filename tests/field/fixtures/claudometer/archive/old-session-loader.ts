export async function loadSessionDetailLegacy(sessionId: string) {
  const response = await fetch(`/api/sessions/${sessionId}`);
  return response.json();
}

export function getSessionDetail(sessionId: string) {
  return loadSessionDetailLegacy(sessionId);
}
