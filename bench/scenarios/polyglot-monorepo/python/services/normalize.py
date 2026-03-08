def normalize_order_payload_bridge(raw_payload: dict) -> dict:
    return {
        "order_id": str(raw_payload.get("order_id", "")).strip(),
        "customer_id": str(raw_payload.get("customer_id", "")).strip(),
        "amount_cents": int(raw_payload.get("amount_cents", 0)),
    }
