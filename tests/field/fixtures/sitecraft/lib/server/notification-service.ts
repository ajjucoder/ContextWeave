import { writeInquiryAuditLog } from "./audit-log";

export async function sendInquiryNotifications(inquiry: { id: string }) {
  return writeInquiryAuditLog(inquiry.id);
}
