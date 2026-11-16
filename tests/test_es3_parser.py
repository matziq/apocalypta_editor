import unittest

from es3_parser import ParseError, at, parse
from oracle_support import javascript_result


class ParserTests(unittest.TestCase):
    def test_inline_values_and_original_spans(self):
        source = '\ufeff{\r\n "name":"\U0001f680", "field":{"__type":"float"1e2}, "ref":9005913460443800891\r\n}'
        tree = parse(source)
        scalar = at(tree, "field").implicit
        self.assertEqual(scalar.value, 100)
        self.assertEqual(source[scalar.start:scalar.end], "1e2")
        self.assertEqual(at(tree, "name").value, "\U0001f680")
        self.assertEqual(source[tree.start:tree.end], source[1:])

    def test_nested_values_and_named_type(self):
        tree = parse('{"setting":{"__type":"bool","value":false},"unknown":[null,true,"x"]}')
        self.assertFalse(at(tree, "setting", "value").value)
        self.assertEqual([item.kind for item in at(tree, "unknown").items], ["null", "boolean", "string"])

    def test_rejects_malformed_and_duplicate_data(self):
        for source in ("", "binary", "[]", '{"a":1,"a":2}', '{"a":[1,]}',
                       '{"a":{"__type":"bool",}}', '{"a":"\\q"}', '{"a":1} trailing'):
            with self.subTest(source=source), self.assertRaises(ParseError):
                parse(source)

    def test_rejects_deep_structures(self):
        with self.assertRaisesRegex(ParseError, "complex"):
            parse('{"x":' + "[" * 152 + "0" + "]" * 152 + "}")

    def test_rejects_too_large_input(self):
        with self.assertRaisesRegex(ParseError, "20 MiB"):
            parse(" " * (20 * 1024 * 1024) + "{}")

    def test_synthetic_trees_match_existing_javascript_parser(self):
        examples = [
            '\ufeff{\r\n "name":"\U0001f680", "field":{"__type":"float"1e2}, "ref":9005913460443800891\r\n}',
            '{"settings":{"__type":"bool","value":false},"unknown":[null,true,"escaped\\nstring"]}',
            '{"values":[-3,1e-3,{"nested":{"__type":"int"42}}]}',
            '{"bad":1,"bad":2}',
            '{"bad":[0,]}',
            '{"bad":"\\q"}',
        ]
        def simplify(node):
            output = {"kind": node.kind}
            if node.kind in ("string", "boolean", "number", "null"):
                output["value"] = node.value
            if node.kind == "object":
                output["props"] = {key: simplify(child) for key, child in node.props.items()}
            if node.kind == "array":
                output["items"] = [simplify(child) for child in node.items]
            if node.implicit is not None:
                output["implicit"] = simplify(node.implicit)
            return output

        for source, expected in zip(examples, javascript_result(self._testMethodName), strict=True):
            with self.subTest(source=source):
                if "error" in expected:
                    with self.assertRaises(ParseError):
                        parse(source)
                else:
                    self.assertEqual(simplify(parse(source)), expected["tree"])


if __name__ == "__main__":
    unittest.main()
