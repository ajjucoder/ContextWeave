import { submitInquiry } from "../lib/client/inquiry-api";

export async function handleInquirySubmit(formData: { email: string; message: string }) {
  return submitInquiry(formData);
}

export function InquiryForm() {
  return null;
}
