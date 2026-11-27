import json
from pathlib import Path


def javascript_result(test_name):
    path = Path(__file__).parent / "fixtures" / "native_engine_oracle.json"
    with path.open(encoding="utf-8") as source:
        return json.load(source, parse_int=float)[test_name]
