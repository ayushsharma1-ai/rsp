"""
Event Bus — decouples domain actions from side effects (notifications, audit logs).

Why this matters:
  BookingService emits BookingApproved → NotificationService reacts.
  BookingService never imports NotificationService directly.
  This is the foundation for future async queues (Celery, Redis Streams, etc.)
"""

from collections import defaultdict
from typing import Callable, Any


class EventBus:
    def __init__(self):
        self._handlers: dict[str, list[Callable]] = defaultdict(list)

    def subscribe(self, event_name: str, handler: Callable):
        self._handlers[event_name].append(handler)

    def publish(self, event_name: str, payload: Any = None):
        for handler in self._handlers.get(event_name, []):
            try:
                handler(payload)
            except Exception as e:
                # In production: log to error tracker, never crash the caller
                print(f"[EventBus] Handler error for '{event_name}': {e}")


# Singleton — in production this would be replaced by a real message broker
bus = EventBus()
