from fastapi import FastAPI

from .ingestion import ingest_order_payload

app = FastAPI()


@app.post("/orders/ingest")
def create_order_endpoint(payload: dict) -> dict:
    normalized = ingest_order_payload(payload)
    return {"status": "accepted", "order_id": normalized["order_id"]}
