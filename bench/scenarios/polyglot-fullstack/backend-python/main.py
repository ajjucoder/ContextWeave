from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import List
from . import signals

app = FastAPI()

class Item(BaseModel):
    id: str
    name: str

_items: dict[str, Item] = {}

@app.get("/api/items")
def list_items() -> List[Item]:
    return list(_items.values())

@app.post("/api/items")
def create_item(item: Item) -> Item:
    _items[item.id] = item
    signals.item_created.send(sender=create_item, item=item)
    return item

@app.get("/api/items/{item_id}")
def get_item(item_id: str) -> Item:
    if item_id not in _items:
        raise HTTPException(status_code=404, detail="Not found")
    return _items[item_id]

@app.delete("/api/items/{item_id}")
def delete_item(item_id: str) -> dict:
    if item_id not in _items:
        raise HTTPException(status_code=404, detail="Not found")
    del _items[item_id]
    signals.item_deleted.send(sender=delete_item, item_id=item_id)
    return {"ok": True}
