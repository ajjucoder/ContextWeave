import { createInvoiceRecord } from "../../../../shared/src/billing.ts";
import { normalizeOrderPayload } from "../../../../shared/src/normalize.ts";
import { enforceRetentionPolicy } from "../../../../shared/src/policy.ts";

export interface OrderInput {
  orderId: string;
  customerId: string;
  amountCents: number;
}

export function createOrderRoute(input: OrderInput): { invoiceId: string; customerId: string } {
  const normalized = normalizeOrderPayload(input);
  enforceRetentionPolicy("orders", normalized.customerId);
  return createInvoiceRecord(normalized);
}

export function registerOrdersRoute(): string {
  return "POST /orders";
}
