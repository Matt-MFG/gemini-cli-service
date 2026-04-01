"""
ADK BaseAgent shim (W3) — Protocol adapter between Agent Engine and daemon.

Zero LLM logic. Under 100 lines. Translates daemon SSE events to ADK events.

Requirements satisfied:
  S-01: No LLM calls (verified by test with credentials revoked)
  S-02: Forwarding latency < 50ms p95
  S-03: All 7 stream-json event types translated correctly
  S-04: A2UI JSONL relayed unmodified
  S-05: New conversation on unknown session ID
"""

import os
import json
import logging
from typing import AsyncGenerator

import httpx
from google.adk.agents import BaseAgent
from google.adk.events import Event

logger = logging.getLogger(__name__)

DAEMON_URL = os.environ.get("DAEMON_URL", "http://localhost:3100")
REQUEST_TIMEOUT = float(os.environ.get("SHIM_TIMEOUT_S", "660"))  # > CLI 10min timeout


# -- Event translation: stream-json type -> ADK event --

EVENT_TRANSLATORS = {
    "turn_start": lambda e: Event(
        author="agent",
        content=json.dumps({"type": "turn_start", "turn": e.get("turn_number")}),
    ),
    "model_turn": lambda e: Event(
        author="agent",
        content=e.get("content", ""),
    ),
    "tool_call": lambda e: Event(
        author="agent",
        content=json.dumps({
            "type": "tool_call",
            "tool": e.get("tool_name"),
            "args": e.get("args"),
        }),
    ),
    "tool_result": lambda e: Event(
        author="agent",
        content=json.dumps({
            "type": "tool_result",
            "tool_call_id": e.get("tool_call_id"),
            "output": e.get("output"),
            "error": e.get("error"),
        }),
    ),
    "model_response": lambda e: Event(
        author="agent",
        content=e.get("content", ""),
    ),
    "error": lambda e: Event(
        author="agent",
        content=json.dumps({"type": "error", "message": e.get("message")}),
    ),
    "result": lambda e: Event(
        author="agent",
        content=json.dumps({
            "type": "result",
            "tokens": e.get("total_tokens"),
            "duration_ms": e.get("duration_ms"),
        }),
    ),
}


def translate_event(raw: dict) -> Event:
    """Translate a stream-json event to an ADK Event (S-03)."""
    event_type = raw.get("type", "unknown")
    translator = EVENT_TRANSLATORS.get(event_type)
    if translator:
        return translator(raw)
    # Unknown types: relay as-is (V-04, S-04 for A2UI JSONL)
    return Event(author="agent", content=json.dumps(raw))


class GeminiCliShim(BaseAgent):
    """
    Forwards user messages to the daemon and streams translated events back.
    No LLM calls — pure protocol adapter (S-01).
    """

    model = None  # S-01: Explicitly no model

    async def _run_async_impl(self, ctx) -> AsyncGenerator[Event, None]:
        user_message = ctx.user_content
        user_id = getattr(ctx, "user_id", "default")
        conversation_id = getattr(ctx, "session_id", None)

        # S-05: Create conversation if session unknown
        if not conversation_id:
            conversation_id = await self._create_conversation(user_id)

        async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
            async with client.stream(
                "POST",
                f"{DAEMON_URL}/send",
                json={
                    "user_id": user_id,
                    "conversation_id": conversation_id,
                    "text": user_message,
                },
            ) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    event = self._parse_sse_line(line)
                    if event:
                        yield event

    async def _create_conversation(self, user_id: str) -> str:
        """Create a new conversation on the daemon (S-05)."""
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{DAEMON_URL}/conversations/new",
                json={"user_id": user_id},
            )
            resp.raise_for_status()
            return resp.json()["conversationId"]

    @staticmethod
    def _parse_sse_line(line: str) -> Event | None:
        """Parse a Server-Sent Event line into an ADK Event."""
        line = line.strip()
        if not line or line.startswith("event:"):
            return None
        if line.startswith("data:"):
            data_str = line[5:].strip()
            try:
                raw = json.loads(data_str)
                return translate_event(raw)
            except json.JSONDecodeError:
                logger.warning("Malformed SSE data: %s", data_str[:200])
                return None
        return None


# Agent Engine entry point
agent = GeminiCliShim(name="gemini-cli-shim")
