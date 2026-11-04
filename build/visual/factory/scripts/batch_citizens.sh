#!/bin/bash
# M4.10 batch driver: build + web-profile + gates + standees for citizen
# kits, one JSON result line per citizen appended to the log. Continues
# past individual failures; the log is the record to fix stragglers from.
#   scripts/batch_citizens.sh <slug> [slug ...]
cd "$(dirname "$0")/.."
BL="${BLENDER:-$HOME/workspace/tools/blender/blender-5.2.2-linux-x64/blender}"
LOG="work-citizens/batch-log.jsonl"
mkdir -p work-citizens
for SLUG in "$@"; do
  echo "=== $SLUG ==="
  python3 - "$SLUG" <<'PYEOF'
import json, subprocess, sys, os, re
slug = sys.argv[1]
BL = os.path.expanduser("~/workspace/tools/blender/blender-5.2.2-linux-x64/blender")
rec = {"citizen": slug}
def run(cmd, **kw):
    return subprocess.run(cmd, capture_output=True, text=True, **kw)
# 1. master build
r = run([BL, "-b", "--python", "scripts/build_citizen.py", "--",
         "--kit", f"kits/citizens/{slug}.json", "--out", f"outputs-v2/{slug}.glb"])
m = re.search(r"CITIZEN_BUILD_SUMMARY (\{.*\})", r.stdout)
if not m:
    rec["stage"] = "build"; rec["error"] = (r.stdout + r.stderr)[-500:]
    print(json.dumps(rec)); sys.exit(0)
s = json.loads(m.group(1))
rec.update({"base": s["base"], "master_bytes": s["bytes"],
            "master_tris": s["tris_master"], "head_share_est": s["head_share_est"],
            "meshes": s["meshes"], "props": s.get("props", []), "sash": s.get("sash", False)})
# 2. chibi measure gate on the master
r = run(["node", "../chibi/measure-figure.mjs", f"outputs-v2/{slug}.glb"], cwd=".")
mm = re.search(r"head share ([\d.]+)%", r.stdout)
rec["measure_gate_exit"] = r.returncode
rec["head_share"] = float(mm.group(1)) / 100 if mm else None
# 3. web profile (script itself gates both LODs + load tests)
r = run(["bash", "scripts/build_web.sh", slug])
rec["web_ok"] = r.returncode == 0
if not rec["web_ok"]:
    rec["web_tail"] = (r.stdout + r.stderr)[-400:]
for lod in ("lod0", "lod1"):
    p = f"outputs-web/{slug}--{lod}.glb"
    if os.path.exists(p):
        v = run(["python3", "scripts/validate_glb.py", "--profile", lod, "--gate", p])
        try:
            d = json.loads(v.stdout)
            rec[lod] = {"bytes": d["bytes"], "tris": d["triangles"],
                        "gate": d["profile_gate"]["pass"]}
        except Exception:
            rec[lod] = {"error": (v.stdout + v.stderr)[-300:]}
# 4. standees
r = run(["bash", "scripts/build_standees.sh", slug])
sm = re.search(r"STANDEE_SUMMARY (\{.*\})", r.stdout + r.stderr)
if sm:
    sd = json.loads(sm.group(1))
    rec["standees"] = sd["sprites"]
    rec["standee_verdicts"] = sd["verdicts"]
else:
    rec["standees_error"] = (r.stdout + r.stderr)[-400:]
print(json.dumps(rec))
with open("work-citizens/batch-log.jsonl", "a") as f: f.write(json.dumps(rec) + "\n")
PYEOF
done
echo "BATCH DONE"
