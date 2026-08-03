from __future__ import annotations

from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.errors import error_payload
from app.services.rate_limit import SlidingWindowRateLimiter


class AnalyzeRequestGuardMiddleware:
    def __init__(
        self,
        app: ASGIApp,
        *,
        rate_limiter: SlidingWindowRateLimiter,
        max_body_bytes: int,
    ) -> None:
        self._app = app
        self._rate_limiter = rate_limiter
        self._max_body_bytes = max_body_bytes

    async def __call__(
        self,
        scope: Scope,
        receive: Receive,
        send: Send,
    ) -> None:
        if (
            scope["type"] != "http"
            or scope["method"] != "POST"
            or scope["path"] != "/v1/routes/analyze"
        ):
            await self._app(scope, receive, send)
            return

        client = scope.get("client")
        client_key = client[0] if client else "anonymous"
        if not await self._rate_limiter.allow(client_key):
            retry_after = await self._rate_limiter.retry_after_seconds(client_key)
            await self._send_error(
                scope,
                receive,
                send,
                status_code=429,
                code="RATE_LIMITED",
                message="Too many requests. Please wait a moment and try again.",
                retryable=True,
                headers={
                    "Retry-After": str(
                        retry_after or self._rate_limiter.window_seconds
                    ),
                },
            )
            return

        headers = dict(scope.get("headers", []))
        content_length = headers.get(b"content-length")
        if content_length is not None:
            try:
                declared_length = int(content_length)
            except ValueError:
                await self._send_invalid_content_length(
                    scope,
                    receive,
                    send,
                )
                return
            if declared_length < 0:
                await self._send_invalid_content_length(
                    scope,
                    receive,
                    send,
                )
                return
            if declared_length > self._max_body_bytes:
                await self._send_too_large(scope, receive, send)
                return

        consumed = 0
        buffered_messages: list[Message] = []
        while True:
            message = await receive()
            buffered_messages.append(message)
            if message["type"] == "http.disconnect":
                break
            if message["type"] != "http.request":
                continue
            consumed += len(message.get("body", b""))
            if consumed > self._max_body_bytes:
                await self._send_too_large(scope, receive, send)
                return
            if not message.get("more_body", False):
                break

        message_index = 0

        async def replay_receive() -> Message:
            nonlocal message_index
            if message_index < len(buffered_messages):
                message = buffered_messages[message_index]
                message_index += 1
                return message
            return {
                "type": "http.request",
                "body": b"",
                "more_body": False,
            }

        await self._app(scope, replay_receive, send)

    async def _send_invalid_content_length(
        self,
        scope: Scope,
        receive: Receive,
        send: Send,
    ) -> None:
        await self._send_error(
            scope,
            receive,
            send,
            status_code=400,
            code="INVALID_INPUT",
            message="The Content-Length header is invalid.",
            retryable=False,
        )

    async def _send_too_large(
        self,
        scope: Scope,
        receive: Receive,
        send: Send,
    ) -> None:
        await self._send_error(
            scope,
            receive,
            send,
            status_code=413,
            code="REQUEST_TOO_LARGE",
            message="The request body is too large.",
            retryable=False,
        )

    @staticmethod
    async def _send_error(
        scope: Scope,
        receive: Receive,
        send: Send,
        *,
        status_code: int,
        code: str,
        message: str,
        retryable: bool,
        headers: dict[str, str] | None = None,
    ) -> None:
        response = JSONResponse(
            status_code=status_code,
            content=error_payload(code, message, retryable, None),
            headers=headers,
        )
        await response(scope, receive, send)
