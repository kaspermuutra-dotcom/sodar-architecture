import unittest

from sodar import paths, schema


class SchemaValidatorTests(unittest.TestCase):
    def test_required_and_type(self):
        s = {
            "type": "object",
            "required": ["a"],
            "properties": {"a": {"type": "integer"}},
            "additionalProperties": False,
        }
        self.assertEqual(schema.validate({"a": 1}, s), [])
        self.assertTrue(schema.validate({}, s))            # missing required
        self.assertTrue(schema.validate({"a": "x"}, s))    # wrong type
        self.assertTrue(schema.validate({"a": 1, "b": 2}, s))  # additional

    def test_bool_is_not_integer(self):
        s = {"type": "integer"}
        self.assertTrue(schema.validate(True, s))

    def test_const_and_enum(self):
        self.assertEqual(schema.validate("v1", {"const": "v1"}), [])
        self.assertTrue(schema.validate("v2", {"const": "v1"}))
        self.assertEqual(schema.validate("pass", {"enum": ["pass", "fail"]}), [])
        self.assertTrue(schema.validate("maybe", {"enum": ["pass", "fail"]}))

    def test_eval_result_schema_loads(self):
        s = schema.load_schema(paths.EVAL_RESULT_SCHEMA)
        self.assertEqual(s["properties"]["schema_version"]["const"], "eval-result.v1")


if __name__ == "__main__":
    unittest.main()
