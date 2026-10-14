"""Tests for the sentinel v1.5 resources block. Run:  python3 -m unittest tools/sentinel/test_resources.py -v
Uses a throwaway SENTINEL_DIR; imports sentinel.py as a module (main() is guarded)."""
import importlib.util
import json
import os
import tempfile
import unittest

os.environ["SENTINEL_DIR"] = tempfile.mkdtemp(prefix="sentinel-test-")
_spec = importlib.util.spec_from_file_location("sentinel", os.path.join(os.path.dirname(__file__), "sentinel.py"))
S = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(S)

MEMINFO = """MemTotal:       126856736 kB
MemFree:         1048576 kB
MemAvailable:   31457280 kB
SwapTotal:       16777216 kB
SwapFree:        16000000 kB
"""
# real GB10 output: memory columns are [N/A]
NVIDIA = "NVIDIA GB10, 41, 0, [N/A], [N/A]\n"
NVIDIA_2 = "NVIDIA RTX 4090, 67, 93, 10240, 24564\nNVIDIA RTX 4090, 70, 12, 512, 24564\n"
ROCM = """GPU[0]		: Temperature (Sensor edge) (C): 30.0
GPU[0]		: Temperature (Sensor junction) (C): 37.0
GPU[0]		: Temperature (Sensor memory) (C): 44.0
"""
PS = """    1  9000 systemd
 3061586 12384948 /home/neo/ollama/lib/ollama/llama-server
 449386 12271600 /home/neo/ComfyUI/.venv/bin/python
 3207069 1146416 python
"""
NFT = """table inet studio_lab {
	chain output {
		type filter hook output priority filter; policy accept;
		meta skuid 1001 ip daddr 127.0.0.53 udp dport 53 accept
		meta skuid 1001 ip daddr { 10.0.0.0/8 } counter packets 12 bytes 720 drop
		meta skuid 1001 ip6 daddr { ::1 } counter packets 3 bytes 100 drop
	}
}"""


class Parsers(unittest.TestCase):
    def test_meminfo(self):
        m = S.parse_meminfo(MEMINFO)
        self.assertEqual(m["MemTotal"], 126856736)
        self.assertEqual(m["MemAvailable"], 31457280)
        self.assertEqual(m["SwapFree"], 16000000)

    def test_meminfo_garbage(self):
        self.assertEqual(S.parse_meminfo(""), {})
        self.assertEqual(S.parse_meminfo(None), {})

    def test_nvidia_na_becomes_none(self):
        g = S.parse_nvidia_smi(NVIDIA)
        self.assertEqual(len(g), 1)
        self.assertEqual(g[0]["temp_c"], 41.0)
        self.assertEqual(g[0]["util_pct"], 0.0)
        self.assertIsNone(g[0]["mem_used_mb"])

    def test_nvidia_two_gpus(self):
        g = S.parse_nvidia_smi(NVIDIA_2)
        self.assertEqual([x["temp_c"] for x in g], [67.0, 70.0])
        self.assertEqual(g[0]["mem_total_mb"], 24564.0)

    def test_nvidia_empty_or_error(self):
        self.assertEqual(S.parse_nvidia_smi(""), [])
        self.assertEqual(S.parse_nvidia_smi("NVIDIA-SMI has failed because it couldn't communicate"), [])

    def test_rocm(self):
        t = S.parse_rocm_temps(ROCM)
        self.assertEqual(t, {"edge": 30.0, "junction": 37.0, "memory": 44.0})
        self.assertEqual(S.parse_rocm_use("GPU[0]\t\t: GPU use (%): 12\n"), 12.0)
        self.assertIsNone(S.parse_rocm_use("nothing"))

    def test_top_rss_names_only_no_args(self):
        top = S.top_rss(PS, 3)
        self.assertEqual([t["comm"] for t in top], ["llama-server", "python", "python"])
        self.assertEqual(top[0]["rss_mb"], round(12384948 / 1024))
        self.assertTrue(all("/" not in t["comm"] for t in top))

    def test_nft_drops_sum_counts_only_drop_lines(self):
        self.assertEqual(S.parse_nft_drops(NFT), 15)

    def test_nft_missing_table_is_none(self):
        self.assertIsNone(S.parse_nft_drops(""))
        self.assertIsNone(S.parse_nft_drops("Error: No such file or directory"))


class Collector(unittest.TestCase):
    def test_resources_never_raises_and_is_small(self):
        r = S.resources()
        self.assertEqual(r["v"], 1)
        self.assertLess(len(json.dumps(r)), 2500)
        self.assertIn("disk", r)

    def test_resources_not_in_fingerprint_sections(self):
        self.assertNotIn("resources", S.SECTIONS)

    def test_stdout_report_has_resources_and_stays_ok(self):
        import subprocess, sys
        env = dict(os.environ, SENTINEL_DIR=tempfile.mkdtemp(prefix="sentinel-test-run-"))
        out = subprocess.run([sys.executable, os.path.join(os.path.dirname(__file__), "sentinel.py"), "--stdout", "--reset"],
                             capture_output=True, text=True, env=env, timeout=120).stdout
        d = json.loads(out)
        self.assertIn("resources", d["meta"])
        self.assertNotIn("resources", d["meta"]["fp"])
        self.assertEqual(d["meta"]["changed"], [])


if __name__ == "__main__":
    unittest.main()
