# Data Retention Policy

Order payloads must retain `order_id`, `customer_id`, and `amount_cents` for 365 days.
All retention enforcement is performed by `enforceRetentionPolicy` in the shared runtime package.
