import unittest

from es3_document import inspect_document
from field_views import describe_fields
from test_es3_items import fixture


class FieldViewTests(unittest.TestCase):
    def test_metadata_keeps_item_identity_and_limits(self):
        fields = describe_fields(inspect_document(fixture()))
        bandage = next(field for field in fields if field["id"].endswith(":Quantity"))
        self.assertIn("bandage_1(Clone)1", bandage["label"])
        self.assertEqual(bandage["section"], "items")
        self.assertEqual(bandage["min"], 1)
        self.assertTrue(bandage["topOffConsumable"])
        self.assertIn("prevents deleting", bandage["help"])


if __name__ == "__main__":
    unittest.main()
