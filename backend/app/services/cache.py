import asyncio
import time
from collections import OrderedDict
from collections.abc import Callable
from dataclasses import dataclass
from typing import Generic, TypeVar

T = TypeVar("T")


@dataclass(slots=True)
class CacheItem(Generic[T]):
    value: T
    expires_at: float


class TtlCache(Generic[T]):
    def __init__(
        self,
        ttl_seconds: int,
        *,
        max_items: int = 2048,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        if ttl_seconds < 0:
            raise ValueError("ttl_seconds cannot be negative.")
        if max_items <= 0:
            raise ValueError("max_items must be positive.")
        self._ttl_seconds = ttl_seconds
        self._max_items = max_items
        self._clock = clock
        self._cleanup_interval_seconds = max(
            1.0,
            min(float(max(ttl_seconds, 1)), 60.0),
        )
        self._next_cleanup_at = self._clock()
        self._items: OrderedDict[str, CacheItem[T]] = OrderedDict()
        self._lock = asyncio.Lock()

    async def get(self, key: str) -> T | None:
        now = self._clock()
        async with self._lock:
            self._purge_expired_locked(now)
            item = self._items.get(key)
            if not item:
                return None
            if item.expires_at <= now:
                self._items.pop(key, None)
                return None
            self._items.move_to_end(key)
            return item.value

    async def set(self, key: str, value: T) -> None:
        if self._ttl_seconds <= 0:
            return
        now = self._clock()
        async with self._lock:
            self._purge_expired_locked(
                now,
                force=len(self._items) >= self._max_items,
            )
            self._items.pop(key, None)
            self._items[key] = CacheItem(
                value=value,
                expires_at=now + self._ttl_seconds,
            )
            while len(self._items) > self._max_items:
                self._items.popitem(last=False)

    async def entry_count(self) -> int:
        now = self._clock()
        async with self._lock:
            self._purge_expired_locked(now, force=True)
            return len(self._items)

    def _purge_expired_locked(
        self,
        now: float,
        *,
        force: bool = False,
    ) -> None:
        if not force and now < self._next_cleanup_at:
            return
        expired_keys = [
            key for key, item in self._items.items() if item.expires_at <= now
        ]
        for key in expired_keys:
            self._items.pop(key, None)
        self._next_cleanup_at = now + self._cleanup_interval_seconds
