export async function writeInquiryAuditLog(inquiryId: string) {
  return `logged:${inquiryId}`;
}
