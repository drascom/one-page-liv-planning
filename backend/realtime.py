"""Simple websocket hub to broadcast schedule updates in real time."""
from __future__ import annotations

import asyncio
from collections import deque
from datetime import datetime, timezone
from typing import Any, Dict, Optional
from uuid import uuid4

from fastapi import APIRouter, Request, WebSocket, WebSocketDisconnect

realtime_router = APIRouter()


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


class RealtimeHub:
    """Tracks websocket connections and sends broadcast events."""

    def __init__(self, history_size: int = 50) -> None:
        self._connections: set[WebSocket] = set()
        self._history: deque[dict[str, Any]] = deque(maxlen=history_size)
        self._lock = asyncio.Lock()

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        async with self._lock:
            self._connections.add(websocket)
        await websocket.send_json({"type": "activity.sync", "items": list(self._history)})

    async def disconnect(self, websocket: WebSocket) -> None:
        async with self._lock:
            self._connections.discard(websocket)

    async def broadcast(self, message: dict[str, Any]) -> None:
        self._history.appendleft(message)
        async with self._lock:
            connections = list(self._connections)
        if not connections:
            return
        stale: list[WebSocket] = []
        for connection in connections:
            try:
                await connection.send_json(message)
            except Exception:
                stale.append(connection)
        for connection in stale:
            await self.disconnect(connection)


hub = RealtimeHub()


def _format_actor(request: Request) -> str:
    user = getattr(request.state, "current_user", None)
    if user:
        username = user.get("username") or f"user-{user.get('id')}"
        return username
    token = getattr(request.state, "api_token", None)
    if token:
        return token.name or f"token-{token.id}"
    return "Another user"


async def publish_event(
    request: Request,
    *,
    entity: str,
    action: str,
    entity_id: int | str,
    summary: str,
    data: Optional[Dict[str, Any]] = None,
) -> None:
    """Compose a standardized activity payload and fan it out."""
    event = {
        "id": str(uuid4()),
        "entity": entity,
        "action": action,
        "type": f"{entity}.{action}",
        "entityId": entity_id,
        "summary": summary,
        "data": data or {},
        "timestamp": _utc_now_iso(),
        "actor": _format_actor(request),
    }
    await hub.broadcast(event)


@realtime_router.websocket("/ws/updates")
async def websocket_updates(websocket: WebSocket) -> None:
    await hub.connect(websocket)
    try:
        while True:
            try:
                await websocket.receive_text()
            except WebSocketDisconnect:
                break
            except Exception:
                # Ignore malformed client messages; the channel is broadcast-only.
                continue
    finally:
        await hub.disconnect(websocket)
