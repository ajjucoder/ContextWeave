from django.dispatch import Signal, receiver

item_created = Signal()
item_deleted = Signal()
item_updated = Signal()

@receiver(item_created)
def on_item_created(sender, item, **kwargs):
    print(f"Item created: {item.id} - {item.name}")

@receiver(item_deleted)
def on_item_deleted(sender, item_id, **kwargs):
    print(f"Item deleted: {item_id}")

@receiver(item_updated)
def on_item_updated(sender, item, **kwargs):
    print(f"Item updated: {item.id}")

def notify_audit_log(event: str, payload: dict) -> None:
    item_updated.send(sender=notify_audit_log, item=payload)
