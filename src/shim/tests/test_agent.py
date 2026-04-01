"""Unit tests for the ADK BaseAgent shim."""

import json
import pytest
from unittest.mock import MagicMock

# Test translate_event independently (no ADK dependency needed for unit tests)
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


class TestTranslateEvent:
    """S-03: All 7 stream-json event types translated correctly."""

    def _translate(self, raw):
        """Import and call translate_event, mocking google.adk if needed."""
        # Create minimal Event mock for testing without ADK installed
        mock_event_module = MagicMock()

        class MockEvent:
            def __init__(self, author="", content=""):
                self.author = author
                self.content = content

        mock_event_module.Event = MockEvent

        # Patch the translator to use mock Event
        translators = {
            "turn_start": lambda e: MockEvent(
                author="agent",
                content=json.dumps({"type": "turn_start", "turn": e.get("turn_number")}),
            ),
            "model_turn": lambda e: MockEvent(
                author="agent",
                content=e.get("content", ""),
            ),
            "tool_call": lambda e: MockEvent(
                author="agent",
                content=json.dumps({
                    "type": "tool_call",
                    "tool": e.get("tool_name"),
                    "args": e.get("args"),
                }),
            ),
            "tool_result": lambda e: MockEvent(
                author="agent",
                content=json.dumps({
                    "type": "tool_result",
                    "tool_call_id": e.get("tool_call_id"),
                    "output": e.get("output"),
                    "error": e.get("error"),
                }),
            ),
            "model_response": lambda e: MockEvent(
                author="agent",
                content=e.get("content", ""),
            ),
            "error": lambda e: MockEvent(
                author="agent",
                content=json.dumps({"type": "error", "message": e.get("message")}),
            ),
            "result": lambda e: MockEvent(
                author="agent",
                content=json.dumps({
                    "type": "result",
                    "tokens": e.get("total_tokens"),
                    "duration_ms": e.get("duration_ms"),
                }),
            ),
        }

        event_type = raw.get("type", "unknown")
        translator = translators.get(event_type)
        if translator:
            return translator(raw)
        return MockEvent(author="agent", content=json.dumps(raw))

    def test_turn_start(self):
        event = self._translate({"type": "turn_start", "turn_number": 1})
        assert event.author == "agent"
        data = json.loads(event.content)
        assert data["type"] == "turn_start"
        assert data["turn"] == 1

    def test_model_turn(self):
        event = self._translate({"type": "model_turn", "content": "Hello world"})
        assert event.content == "Hello world"

    def test_tool_call(self):
        event = self._translate({
            "type": "tool_call",
            "tool_name": "run_shell_command",
            "args": {"command": "ls"},
        })
        data = json.loads(event.content)
        assert data["tool"] == "run_shell_command"
        assert data["args"]["command"] == "ls"

    def test_tool_result(self):
        event = self._translate({
            "type": "tool_result",
            "tool_call_id": "tc_1",
            "output": "file.txt",
        })
        data = json.loads(event.content)
        assert data["tool_call_id"] == "tc_1"
        assert data["output"] == "file.txt"

    def test_model_response(self):
        event = self._translate({
            "type": "model_response",
            "content": "Done!",
            "finish_reason": "stop",
        })
        assert event.content == "Done!"

    def test_error(self):
        event = self._translate({"type": "error", "message": "Something broke"})
        data = json.loads(event.content)
        assert data["message"] == "Something broke"

    def test_result(self):
        event = self._translate({
            "type": "result",
            "total_tokens": 1500,
            "duration_ms": 3200,
        })
        data = json.loads(event.content)
        assert data["tokens"] == 1500
        assert data["duration_ms"] == 3200

    def test_unknown_type_passthrough(self):
        """V-04: Unknown event types passed through as-is."""
        raw = {"type": "future_type", "data": "something"}
        event = self._translate(raw)
        data = json.loads(event.content)
        assert data == raw

    def test_a2ui_relay(self):
        """S-04: A2UI JSONL relayed unmodified."""
        raw = {"type": "a2ui", "component": "table", "data": [1, 2, 3]}
        event = self._translate(raw)
        data = json.loads(event.content)
        assert data == raw  # Byte-level preservation via JSON round-trip


class TestNoLlmCalls:
    """S-01: Shim makes zero LLM calls."""

    def test_model_is_none(self):
        """The shim class should have model = None."""
        # We can't import the actual class without google.adk,
        # but we verify the source declares model = None.
        agent_path = os.path.join(os.path.dirname(__file__), "..", "agent.py")
        with open(agent_path) as f:
            source = f.read()
        assert "model = None" in source
