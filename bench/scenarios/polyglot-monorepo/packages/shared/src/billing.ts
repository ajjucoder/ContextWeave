export interface NormalizedOrder {
  orderId: string;
  customerId: string;
  amountCents: number;
}

export function createInvoiceRecord(order: NormalizedOrder): { invoiceId: string; customerId: string } {
  return {
    invoiceId: `inv_${order.orderId}`,
    customerId: order.customerId,
  };
}
