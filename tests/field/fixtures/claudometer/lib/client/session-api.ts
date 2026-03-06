export async function loadSessionDetail(sessionId: string) {
  const response = await fetch(`/api/sessions/${sessionId}`);
  return response.json();
}
