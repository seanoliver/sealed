"""Rebuild src/lib/address/data/us-zips.json from GeoNames US postal codes.

Download https://download.geonames.org/export/zip/US.zip (CC BY 4.0), unzip
it, then run: python3 -I scripts/build-us-zips.py US.txt src/lib/address/data/us-zips.json
"""
import collections
import json
import sys

zips = collections.OrderedDict()
for line in open(sys.argv[1], encoding="utf-8"):
    fields = line.rstrip("\n").split("\t")
    code, city, state = fields[1], fields[2], fields[4]
    if len(code) != 5 or not code.isdigit() or len(state) != 2:
        continue
    entry = zips.setdefault(code, [state])
    if city not in entry[1:]:
        entry.append(city)
json.dump(zips, open(sys.argv[2], "w"), separators=(",", ":"), ensure_ascii=False)
