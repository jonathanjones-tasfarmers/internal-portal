"""
build.py - build the Hub-pasteable page.

    python3 build.py

Reads src/index.template.html and data/data.json, writes dist/governance.html (one self-contained file:
data inlined, noindex meta added) and dist/BUILD.txt. Nothing is uploaded anywhere.
"""
import json, os
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
tpl = open(os.path.join(HERE, "src", "index.template.html"), encoding="utf8").read()
data = open(os.path.join(HERE, "data", "data.json"), encoding="utf8").read()
assert "__DATA__" in tpl, "template has no __DATA__ placeholder"
json.loads(data)  # fail early on bad data
out = tpl.replace("__DATA__", data)
if 'name="robots"' not in out:
    out = out.replace("<head>", '<head>\n<meta name="robots" content="noindex, nofollow">', 1)
os.makedirs(os.path.join(HERE, "dist"), exist_ok=True)
path = os.path.join(HERE, "dist", "governance.html")
with open(path, "w", encoding="utf8") as fh:
    fh.write(out)
with open(os.path.join(HERE, "dist", "BUILD.txt"), "w") as fh:
    fh.write(f"governance.html built {datetime.now().strftime('%Y-%m-%d %H:%M')}, {len(out.encode('utf8'))} bytes\n")
print(f"Wrote {path} ({len(out.encode('utf8')) / 1024:.0f} KB)")
