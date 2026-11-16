"""Lossless parser for the text-based ES3 PlayMaker save syntax."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any

MAX_BYTES = 20 * 1024 * 1024
_TOKEN = re.compile(r"-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null", re.ASCII)


@dataclass
class Node:
    kind: str
    start: int
    end: int
    value: Any = None
    props: dict[str, Node] = field(default_factory=dict)
    items: list[Node] = field(default_factory=list)
    implicit: Node | None = None


class ParseError(ValueError):
    """The input is not a safely parseable ES3 text save."""


def parse(text: str) -> Node:
    if not isinstance(text, str) or not text.strip():
        raise ParseError("The save is empty.")
    if len(text.encode("utf-8", errors="surrogatepass")) > MAX_BYTES:
        raise ParseError("Save exceeds the 20 MiB limit.")
    pos = 1 if text.startswith("\ufeff") else 0
    count = 0

    def fail(message: str) -> None:
        raise ParseError(f"{message} at character {pos + 1}.")

    def space() -> None:
        nonlocal pos
        while pos < len(text) and text[pos] in " \t\r\n":
            pos += 1

    def value(depth: int) -> Node:
        nonlocal pos, count
        count += 1
        if depth > 150 or count > 500000:
            fail("Save structure is too complex")
        space()
        start = pos
        ch = text[pos:pos + 1]
        if ch == "{":
            pos += 1
            props: dict[str, Node] = {}
            implicit = None
            space()
            if text[pos:pos + 1] != "}":
                while True:
                    space()
                    if text[pos:pos + 1] != '"':
                        fail("Expected a property name")
                    key = value(depth + 1)
                    if key.value in props:
                        fail("Duplicate property")
                    space()
                    if text[pos:pos + 1] != ":":
                        pos += 1
                        fail("Expected a colon")
                    pos += 1
                    child = value(depth + 1)
                    props[key.value] = child
                    space()
                    if key.value == "__type" and text[pos:pos + 1] not in (",", "}"):
                        if child.kind != "string" or implicit is not None:
                            fail("Invalid inline type")
                        implicit = value(depth + 1)
                        space()
                    if text[pos:pos + 1] != ",":
                        break
                    pos += 1
            if text[pos:pos + 1] != "}":
                pos += 1
                fail("Expected closing brace")
            pos += 1
            return Node("object", start, pos, props=props, implicit=implicit)
        if ch == "[":
            pos += 1
            items = []
            space()
            if text[pos:pos + 1] != "]":
                while True:
                    items.append(value(depth + 1))
                    space()
                    if text[pos:pos + 1] != ",":
                        break
                    pos += 1
            if text[pos:pos + 1] != "]":
                pos += 1
                fail("Expected closing bracket")
            pos += 1
            return Node("array", start, pos, items=items)
        if ch == '"':
            pos += 1
            while pos < len(text):
                next_char = text[pos]
                pos += 1
                if next_char == "\\":
                    pos += 1
                    continue
                if next_char == '"':
                    try:
                        decoded = json.loads(text[start:pos])
                    except (ValueError, UnicodeDecodeError):
                        fail("Invalid string")
                    return Node("string", start, pos, value=decoded)
            fail("Unterminated string")
        match = _TOKEN.match(text, pos)
        if not match:
            fail("Expected a value; encrypted and binary saves are not supported")
        raw = match.group()
        pos = match.end()
        if raw == "null":
            return Node("null", start, pos)
        if raw in ("true", "false"):
            return Node("boolean", start, pos, value=raw == "true")
        return Node("number", start, pos, value=float(raw))

    tree = value(0)
    space()
    if pos != len(text) or tree.kind != "object":
        fail("Expected a single save object")
    return tree


def at(node: Node | None, *keys: str) -> Node | None:
    for key in keys:
        node = node.props.get(key) if node is not None and node.kind == "object" else None
    return node
