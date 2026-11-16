"""Replay the existing JavaScript synthetic fixtures against the native engine."""

import gzip
import json
import unittest
from pathlib import Path

from es3_document import inspect_document, serialize_document


class FixtureParityTests(unittest.TestCase):
    def test_frozen_synthetic_oracle(self):
        fixture = Path(__file__).parent / "fixtures" / "javascript_oracle.json.gz"
        with gzip.open(fixture, "rt", encoding="utf-8") as file:
            captured = json.load(file)
        self.assertEqual(captured["failures"], [])
        self.assertEqual(captured["testCount"], 47)
        self.assert_cases(captured)

    def test_fractional_prefab_capacity_boundaries(self):
        fixture = Path(__file__).parent / "fixtures" / "javascript_oracle.json.gz"
        with gzip.open(fixture, "rt", encoding="utf-8") as file:
            captured = json.load(file)
        for name, saved, nominal, next_float in (
                ("3L I5 87HP 172Nm Diesel", 5.0999999, 5.1, 5.100000381469727),
                ("3.7L I6 145HP 292Nm Gasoline", 5.30000019, 5.3, 5.3000006675720215)):
            with self.subTest(name=name):
                matches = [(case, field) for case in captured["records"]
                           if case["operation"] == "inspect" and not case.get("rejected") and name in case["text"]
                           for field in case["fields"] if field[0].endswith(":Liquid") and field[2] == saved]
                self.assertTrue(matches)
                case, field = matches[0]
                for value in (saved, nominal):
                    serialize_document(case["text"], {field[0]: value})
                with self.assertRaises(ValueError):
                    serialize_document(case["text"], {field[0]: next_float})

    def assert_cases(self, captured):
        cases = captured["records"]
        self.assertGreater(len(cases), 100)
        for index, case in enumerate(cases):
            with self.subTest(case=index, operation=case["operation"]):
                def execute():
                    if case["operation"] == "serialize":
                        return serialize_document(case["text"], case["changes"])
                    document = inspect_document(case["text"])
                    return document

                if case.get("rejected"):
                    with self.assertRaises((ValueError, RecursionError)):
                        execute()
                else:
                    actual = execute()
                    if case["operation"] == "serialize":
                        self.assertEqual(actual, case["output"])
                        continue
                    fields = [[field.id, field.type, field.value, field.minimum, field.maximum, field.top_off]
                              for field in actual.fields]
                    self.assertEqual(fields, case["fields"])
                    self.assertEqual(len(actual.items), len(case["items"]))
                    for item, expected in zip(actual.items, case["items"], strict=True):
                        identifier, location, position, field_ids, readonly = expected
                        self.assertEqual((item.id, item.location), (identifier, location))
                        self.assertEqual([field.id for field in item.fields], field_ids)
                        self.assertEqual(item.readonly, readonly)
                        actual_position = actual.world.position(item.object.transform)
                        if position is None:
                            self.assertIsNone(actual_position)
                        else:
                            self.assertIsNotNone(actual_position)
                            for axis in ("x", "y", "z"):
                                self.assertAlmostEqual(actual_position[axis], position[axis])
                    self.assertEqual([[v.id, v.name, sorted(field.id for field in v.fields)] for v in actual.vehicles],
                                     [[identifier, name, sorted(fields)] for identifier, name, fields in case["vehicles"]])


if __name__ == "__main__":
    unittest.main()
