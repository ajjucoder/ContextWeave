import type { OrderInput } from "../../api/src/routes/orders.ts";
import type { NormalizedOrder } from "./billing.ts";

export function normalizeOrderPayload(input: OrderInput): NormalizedOrder {
  return {
    orderId: input.orderId.trim(),
    customerId: input.customerId.trim(),
    amountCents: Math.max(0, input.amountCents),
  };
}
