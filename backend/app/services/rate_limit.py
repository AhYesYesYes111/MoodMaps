import asyncio
import math
import time
from collections import OrderedDict, deque
from collections.abc import Callable


class SlidingWindowRateLimiter:
    def __init__(
        self,
        limit: int,
        window_seconds: int = 60,
        *,
        max_keys: int = 10_000,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        if limit <= 0:
            raise ValueError("limit must be positive.")
        if window_seconds <= 0:
            raise ValueError("window_seconds must be positive.")
        if max_keys <= 0:
            raise ValueError("max_keys must be positive.")
        self._limit = limit
        self._window_seconds = window_seconds
        self._max_keys = max_keys
        self._clock = clock
        self._cleanup_interval_seconds = max(
            1.0,
            min(float(window_seconds), 30.0),
        )
        self._next_cleanup_at = self._clock()
        self._requests: OrderedDict[str, deque[float]] = OrderedDict()
        self._lock = asyncio.Lock()

    @property
    def window_seconds(self) -> int:
        return self._window_seconds

    async def allow(self, key: str) -> bool:
        now = self._clock()
        cutoff = now - self._window_seconds
        async with self._lock:
            self._purge_expired_locked(now)
            requests = self._requests.get(key)
            if requests is None:
                if len(self._requests) >= self._max_keys:
                    self._purge_expired_locked(now, force=True)
                while len(self._requests) >= self._max_keys:
                    self._requests.popitem(last=False)
                requests = deque()
                self._requests[key] = requests
            else:
                self._requests.move_to_end(key)
            while requests and requests[0] <= cutoff:
                requests.popleft()
            if len(requests) >= self._limit:
                return False
            requests.append(now)
            return True

    async def retry_after_seconds(self, key: str) -> int:
        now = self._clock()
        cutoff = now - self._window_seconds
        async with self._lock:
            requests = self._requests.get(key)
            if not requests:
                return 0
            while requests and requests[0] <= cutoff:
                requests.popleft()
            if not requests:
                self._requests.pop(key, None)
                return 0
            if len(requests) < self._limit:
                return 0
            return max(
                1,
                math.ceil(requests[0] + self._window_seconds - now),
            )

    async def entry_count(self) -> int:
        now = self._clock()
        async with self._lock:
            self._purge_expired_locked(now, force=True)
            return len(self._requests)

    def _purge_expired_locked(
        self,
        now: float,
        *,
        force: bool = False,
    ) -> None:
        if not force and now < self._next_cleanup_at:
            return
        cutoff = now - self._window_seconds
        expired_keys: list[str] = []
        for key, requests in self._requests.items():
            while requests and requests[0] <= cutoff:
                requests.popleft()
            if not requests:
                expired_keys.append(key)
        for key in expired_keys:
            self._requests.pop(key, None)
        self._next_cleanup_at = now + self._cleanup_interval_seconds
