# -*- coding: utf-8 -*-
# Karlik xlsx -> scripts/karlik-import.json  (Produkte + Farbvarianten)
import openpyxl, json, re
from collections import defaultdict, Counter

SRC = "C:/Users/alisa/Downloads/IMERA_Karlik_Ali_Import.xlsx"
OUT = "scripts/karlik-import.json"

def slugify(s):
    s = str(s or '').lower()
    s = s.replace('ä','ae').replace('ö','oe').replace('ü','ue').replace('ß','ss')
    s = re.sub(r'[^a-z0-9]+','-', s).strip('-')
    return s

CAT_MAP = {
    '⚠️ prüfen: frames - glass effect - DECO Art': 'Rahmen Glasoptik DECO Art',
    '⚠️ prüfen: modular junction boxes': 'Modulare Verbindungsdosen',
    '⚠️ prüfen: DECO Pastel Matt': 'Rahmen DECO Pastell Matt',
    '⚠️ prüfen: dimmers': 'Dimmer',
    '⚠️ prüfen: frames - glass effect - non-standard modular': 'Rahmen Glasoptik modular (Sondermaße)',
    '⚠️ prüfen: central vacum cleaner suction socket': 'Zentralstaubsauger-Dose',
}

# Farb-Reihenfolge (Weiß zuerst, dann gängige Farben)
COLOR_ORDER = ['Weiß','Mattweiß','Beige','Silber Metallic','Gold','Gold Metallic','Graphit',
               'Mattgraphit','Mattgrau','Mattschwarz','Braun Metallic','Taupe','Salbeigrün',
               'Lachs','Terrakotta']
def color_rank(c):
    return COLOR_ORDER.index(c) if c in COLOR_ORDER else len(COLOR_ORDER) + (hash(c) % 100)

def clean(s):
    return str(s or '').replace('\xa0',' ').strip()

def strip_color_paren(n):
    return re.sub(r'\s*\([^)]*\)\s*$','', n).strip()

def base_name(vs):
    # Bevorzugt deutscher Name ohne ⚠️; sonst Englisch (Spalte D)
    ger = [strip_color_paren(clean(v[2])) for v in vs if not (v[2] and '⚠' in str(v[2]))]
    if ger:
        return Counter(ger).most_common(1)[0][0], False
    en = clean(vs[0][3]) or clean(vs[0][2])
    en = re.sub(r'^⚠️?\s*manuell prüfen:\s*','', en, flags=re.I)
    return en, True

wb = openpyxl.load_workbook(SRC, read_only=True, data_only=True)
ws = wb["Import"]
data = [r for i,r in enumerate(ws.iter_rows(values_only=True)) if i>=5 and r[0] is not None]

# Gruppieren nach (Basis-Artikel, Serie)
groups = defaultdict(list)
for r in data:
    groups[(r[1], r[4])].append(r)

cats = {}   # slug -> name
products = []
sku_used = set()
slug_used = set()
warn_products = []

for (base, serie), vs in groups.items():
    # Kategorie (häufigste in der Gruppe), ⚠️ gemappt
    cat_raw = Counter(clean(v[5]) for v in vs).most_common(1)[0][0]
    cat_name = CAT_MAP.get(cat_raw, cat_raw)
    cat_slug = slugify(cat_name)
    cats.setdefault(cat_slug, cat_name)

    name, warned = base_name(vs)
    # eindeutige SKU/slug
    sku = str(base)
    if sku in sku_used:
        sku = f"{base}-{serie}"
    sku_used.add(sku)
    slug = slugify(f"{base}-{serie}")
    if slug in slug_used:
        n = 2
        while f"{slug}-{n}" in slug_used: n += 1
        slug = f"{slug}-{n}"
    slug_used.add(slug)

    # Varianten sortiert
    variants = []
    for v in sorted(vs, key=lambda x: (color_rank(clean(x[6])), clean(x[6]))):
        variants.append({
            "sku": clean(v[0]),
            "color": clean(v[6]),
            "ean": clean(v[7]),
            "price": round(float(v[8]), 2) if v[8] is not None else None,
            "image": clean(v[10]),
        })
    variants = [x for x in variants if x["price"] is not None]
    if not variants:
        continue
    price_min = min(x["price"] for x in variants)
    default = variants[0]  # Weiß bzw. erste

    if warned:
        warn_products.append(sku)

    products.append({
        "sku": sku,
        "slug": slug,
        "name": name,
        "series": serie,
        "category_slug": cat_slug,
        "short_description": f"Karlik {serie} – {cat_name}",
        "image": default["image"],
        "price_min": price_min,
        "warn": warned,
        "variants": variants,
    })

out = {
    "brand": {"name": "Karlik", "slug": "karlik"},
    "categories": [{"name": n, "slug": s} for s, n in sorted(cats.items())],
    "products": products,
}
with open(OUT, "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False)

nv = sum(len(p["variants"]) for p in products)
print(f"Produkte: {len(products)} | Varianten: {nv} | Kategorien: {len(cats)} | ⚠️ Produkte: {len(warn_products)}")
print("Beispiel:", json.dumps(products[0], ensure_ascii=False)[:300])
