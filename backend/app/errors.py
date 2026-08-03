from dataclasses import dataclass


@dataclass(slots=True)
class ApiError(Exception):
    code: str
    message: str
    status_code: int
    retryable: bool = False
    request_id: str | None = None


def error_payload(
    code: str,
    message: str,
    retryable: bool,
    request_id: str | None,
) -> dict[str, dict[str, str | bool | None]]:
    return {
        "error": {
            "code": code,
            "message": message,
            "retryable": retryable,
            "requestId": request_id,
        }
    }
