import unittest

from es3_scalars import inspect_scalars, serialize_scalars

WRAPPER = "ES3PlayMaker.PMDataWrapper,Assembly-CSharp-firstpass"
GAME = (
    '\ufeff{\r\n "Player":{"__type":"' + WRAPPER
    + '","value":{"objs":{"Health":{"__type":"float"1e2}}}},'
    + '\r\n "Ammo":{"__type":"' + WRAPPER
    + '","value":{"objs":{"ammo_22caliber_capacity":{"__type":"int"22},'
    + '"ammo_9mm":{"__type":"int"12},"armor":{"__type":"float"0}}}},'
    + '\r\n "unknown":{"id":9005913460443800891,"name":"\U0001f680"}\r\n}'
)
SETTINGS = '{"peacefulMode":{"__type":"bool","value":false},"audio_volume":{"__type":"float","value":1},"FOV":{"__type":"float","value":90}}'


class ScalarTests(unittest.TestCase):
    def test_exact_edits_and_untouched_source(self):
        fields, _ = inspect_scalars(GAME)
        self.assertEqual(
            [field.id for field in fields],
            ["Player.Health", "Ammo.armor", "Ammo.ammo_22caliber_capacity", "Ammo.ammo_9mm"],
        )
        self.assertTrue(fields[2].top_off)
        self.assertEqual(serialize_scalars(GAME, {}), GAME)
        self.assertEqual(serialize_scalars(GAME, {"Player.Health": 100}), GAME)
        self.assertEqual(
            serialize_scalars(GAME, {"Player.Health": 75, "Ammo.ammo_22caliber_capacity": 999}),
            GAME.replace('"float"1e2', '"float"75').replace('"int"22', '"int"999'),
        )

    def test_invalid_edits_and_readonly_values(self):
        for value in (-1, 2147483648, 1.5, float("inf"), 10 ** 400, True, "2"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                serialize_scalars(GAME, {"Ammo.ammo_9mm": value})
        with self.assertRaises(ValueError):
            serialize_scalars(GAME, {"unknown": 1})
        text = GAME.replace('"float"1e2', '"float"101')
        fields, readonly = inspect_scalars(text)
        self.assertEqual(readonly[0].id, "Player.Health")
        self.assertNotIn("Player.Health", [field.id for field in fields])
        with self.assertRaises(ValueError):
            serialize_scalars(text, {"Player.Health": 100})

    def test_synthetic_golden_outputs(self):
        cases = [
            (GAME, {}, GAME),
            (GAME, {"Player.Health": 75, "Ammo.ammo_22caliber_capacity": 999},
             GAME.replace('"float"1e2', '"float"75').replace('"int"22', '"int"999')),
            (SETTINGS, {"peacefulMode": True, "audio_volume": 0.000001},
             SETTINGS.replace('"value":false', '"value":true').replace('"value":1}', '"value":0.000001}')),
            (SETTINGS, {"FOV": 119.5}, SETTINGS.replace('"value":90', '"value":119.5')),
        ]
        for text, changes, expected in cases:
            with self.subTest(changes=changes):
                self.assertEqual(serialize_scalars(text, changes), expected)


if __name__ == "__main__":
    unittest.main()
