const BASE_URL = "http://localhost:8000";

export async function fetchItems(): Promise<unknown[]> {
  const res = await fetch(`${BASE_URL}/api/items`);
  return res.json() as Promise<unknown[]>;
}

export async function createItem(data: { name: string }): Promise<unknown> {
  const res = await fetch(`${BASE_URL}/api/items`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return res.json();
}

export async function deleteItem(id: string): Promise<void> {
  await fetch(`${BASE_URL}/api/items/${id}`, { method: "DELETE" });
}
