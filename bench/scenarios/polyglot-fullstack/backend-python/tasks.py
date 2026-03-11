from celery import shared_task
from . import signals

@shared_task
def process_item_async(item_id: str) -> dict:
    print(f"Processing item async: {item_id}")
    signals.item_updated.send(sender=process_item_async, item={"id": item_id})
    return {"processed": item_id}

@shared_task
def cleanup_deleted_items() -> int:
    count = 0
    print(f"Cleanup complete: {count} items removed")
    return count

def schedule_processing(item_id: str) -> None:
    process_item_async.delay(item_id)
