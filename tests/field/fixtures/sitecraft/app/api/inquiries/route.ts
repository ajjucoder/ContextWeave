import { createInquiry } from "../../../lib/server/inquiry-service";
import { sendInquiryNotifications } from "../../../lib/server/notification-service";

export async function POST() {
  const inquiry = await createInquiry();
  await sendInquiryNotifications(inquiry);
  return inquiry;
}
