"""Small contracts for packing/budget policy; no model download or inference."""
import types
import unittest

from run import prepare_batch, select_variant


class TokenizerStub:
    def __init__(self):
        self.calls = []

    def encode(self, premise, hypothesis, add_special_tokens):
        self.calls.append((premise, hypothesis, add_special_tokens))
        count = len(premise)
        return types.SimpleNamespace(ids=list(range(count)), attention_mask=[1] * count, type_ids=[0] * count)


class ContractTests(unittest.TestCase):
    def test_first_fitting_declared_tier_without_truncation(self):
        tokenizer = TokenizerStub()
        pair = {"variants": [
            {"textLimit": 96, "query": "x" * 10, "passage": "field claim"},
            {"textLimit": 64, "query": "x" * 6, "passage": "field claim"},
            {"textLimit": 32, "query": "x", "passage": "field claim"},
        ]}
        variant, encoded, audit = select_variant(tokenizer, pair, 8)
        self.assertEqual(variant["textLimit"], 64)
        self.assertEqual(len(encoded.ids), 6)
        self.assertEqual(len(audit), 2)
        self.assertEqual(tokenizer.calls[0], ("x" * 10, "field claim", True))

    def test_all_over_budget_is_explicit_failure(self):
        with self.assertRaisesRegex(ValueError, "No declared text tier"):
            select_variant(TokenizerStub(), {"variants": [{"textLimit": 32, "query": "x" * 10, "passage": "claim"}]}, 8)

    def test_padding_preserves_values_and_masks(self):
        encodings = [
            types.SimpleNamespace(ids=[0, 9, 2], attention_mask=[1, 1, 1], type_ids=[0, 0, 0]),
            types.SimpleNamespace(ids=[0, 2], attention_mask=[1, 1], type_ids=[0, 0]),
        ]
        feeds = prepare_batch(encodings, ["input_ids", "attention_mask"])
        self.assertEqual(feeds["input_ids"].tolist(), [[0, 9, 2], [0, 2, 0]])
        self.assertEqual(feeds["attention_mask"].tolist(), [[1, 1, 1], [1, 1, 0]])
        self.assertNotIn("token_type_ids", feeds)

    def test_unknown_model_input_is_not_silently_omitted(self):
        encoded = types.SimpleNamespace(ids=[0, 2], attention_mask=[1, 1], type_ids=[0, 0])
        with self.assertRaisesRegex(ValueError, "Unexpected ONNX input"):
            prepare_batch([encoded], ["input_ids", "unknown_input"])


if __name__ == "__main__":
    unittest.main()
