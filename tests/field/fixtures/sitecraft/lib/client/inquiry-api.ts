export async function submitInquiry(formData: { email: string; message: string }) {
  const response = await fetch("/api/inquiries", {
    method: "POST",
    body: JSON.stringify(formData),
  });

  return response.json();
}
