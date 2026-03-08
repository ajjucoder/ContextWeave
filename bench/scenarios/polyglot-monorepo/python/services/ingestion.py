from .normalize import normalize_order_payload_bridge


def ingest_order_payload(raw_payload: dict) -> dict:
    normalized = normalize_order_payload_bridge(raw_payload)
    return {
        "order_id": normalized["order_id"],
        "customer_id": normalized["customer_id"],
        "amount_cents": normalized["amount_cents"],
    }
