# -*- coding: utf-8 -*-
# Pawbol xlsx -> scripts/pawbol-import.json (wellenweise)
# Aufruf: python scripts/pawbol-gen.py A1            (nur Gruppe A1)
#         python scripts/pawbol-gen.py A1,A2,B6      (mehrere)
#         python scripts/pawbol-gen.py ALL           (alle)
import os, openpyxl, json, re, sys

def slugify(s):
    s = str(s or '').lower()
    s = s.replace('ä','ae').replace('ö','oe').replace('ü','ue').replace('ß','ss')
    s = re.sub(r'[^a-z0-9]+','-', s).strip('-')
    return s

d = "C:/Users/alisa/Downloads"
path = os.path.join(d, [f for f in os.listdir(d) if 'pawbol' in f.lower()][0])
wb = openpyxl.load_workbook(path, read_only=True, data_only=True)

# Kategorien-Mapping: Datencode (A1) -> Beschreibung. Blatt nutzt PA1 → 'P' strippen.
catmap = {}
for row in wb['Rabattgruppe'].iter_rows(min_row=2, values_only=True):
    code, desc = row[0], row[1]
    if code and desc:
        key = str(code)[1:] if str(code).startswith('P') else str(code)
        catmap[key] = str(desc).strip()

ws = wb['PREISLISTE']
data = [r for i, r in enumerate(ws.iter_rows(min_row=10, values_only=True)) if r and r[1]]

arg = (sys.argv[1] if len(sys.argv) > 1 else 'A1').upper()
groups = None if arg == 'ALL' else set(arg.split(','))

def num(v):
    try: return float(v)
    except (TypeError, ValueError): return None
def as_int(v, dflt=1):
    try: return int(float(v))
    except (TypeError, ValueError): return dflt
def clean(v):
    return str(v).replace('\xa0', ' ').strip() if v is not None else ''

cats, products = {}, []
slug_used, sku_used = set(), set()
skipped = 0
for r in data:
    code = clean(r[6])
    if groups is not None and code not in groups:
        continue
    sku = clean(r[1])
    name = clean(r[2])
    lp = num(r[3])
    if not sku or not name or lp is None:
        skipped += 1; continue
    # ZURÜCKGEZOGEN (zurückgezogen) über Kommentar grob filtern
    komm = clean(r[20]).upper()
    if 'WYCOF' in komm or 'ZURÜCK' in komm.upper():
        skipped += 1; continue

    cat_name = catmap.get(code, 'Pawbol Sonstiges')
    cat_slug = slugify(cat_name); cats.setdefault(cat_slug, cat_name)

    slug = slugify(f"{name}-{sku}")[:80]
    if slug in slug_used:
        n = 2
        while f"{slug}-{n}" in slug_used: n += 1
        slug = f"{slug}-{n}"
    slug_used.add(slug)
    if sku in sku_used:
        sku = f"{sku}-{code}"
    sku_used.add(sku)

    unit = clean(r[7]) or 'Stück'
    per_pack = as_int(r[8], 1)
    moq = as_int(r[10], 1)

    # Specs
    specs = []
    ean = clean(r[12])
    if ean: specs.append(["EAN", ean])
    w = num(r[14])
    if w: specs.append(["Nettogewicht", f"{w:g} kg"])
    L, B, H = num(r[15]), num(r[16]), num(r[17])
    if L and B and H: specs.append(["Abmessungen (L×B×H)", f"{L:g} × {B:g} × {H:g} mm"])
    if unit: specs.append(["Verkaufseinheit", unit])
    if per_pack > 1: specs.append(["Einheiten pro Gebinde", str(per_pack)])

    # Produktbeschreibung (Pawbol liefert keine Langtexte → aus Name + Kontext bilden)
    desc = f"{name}. {cat_name} von Pawbol."
    if per_pack > 1:
        desc += f" Lieferung im Gebinde à {per_pack} {unit}."
    if moq > 1:
        desc += f" Mindestbestellmenge: {moq} {unit}."

    products.append({
        "sku": sku, "slug": slug, "name": name,
        "category_slug": cat_slug,
        "list_price": round(lp, 4),
        "moq": moq, "unit_label": unit, "units_per_pack": per_pack,
        "specs": specs,
        "short_description": f"Pawbol · {cat_name}",
        "description": desc,
    })

out = {
    "brand": {"name": "Pawbol", "slug": "pawbol"},
    "categories": [{"name": n, "slug": s} for s, n in sorted(cats.items())],
    "products": products,
}
with open("scripts/pawbol-import.json", "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False)

print(f"Welle: {arg} | Produkte: {len(products)} | Kategorien: {len(cats)} | übersprungen: {skipped}")
if products:
    print("Beispiel:", json.dumps(products[0], ensure_ascii=False)[:280])
print("Kategorien:", [c['name'] for c in out['categories']])
