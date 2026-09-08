# -*- coding: utf-8 -*-
# Pawbol-Nettogewichte (kg) aus der Preisliste extrahieren → scripts/pawbol-weights.json
# SKU-Logik spiegelt pawbol-gen.py (inkl. Dubletten-Suffix "-{code}"), damit die
# erzeugten SKUs exakt zu den importierten Produkten passen.
import os, openpyxl, json

d = "C:/Users/alisa/Downloads"
path = os.path.join(d, "PREISLISTE PAWBOL2026_export_DE.K.xlsx")
wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
ws = wb['PREISLISTE']

def clean(v):
    return ("" if v is None else str(v)).strip()

def num(v):
    if v is None:
        return None
    try:
        return float(str(v).replace(',', '.'))
    except Exception:
        return None

data = [r for r in ws.iter_rows(min_row=10, values_only=True) if r and len(r) > 14 and r[1]]

weights = {}
sku_used = set()
missing = 0
for r in data:
    code = clean(r[6])
    sku = clean(r[1])
    name = clean(r[2])
    lp = num(r[3])
    if not sku or not name or lp is None:
        continue
    komm = clean(r[20]).upper() if len(r) > 20 else ''
    if 'WYCOF' in komm or 'ZURÜCK' in komm:
        continue
    if sku in sku_used:
        sku = f"{sku}-{code}"
    sku_used.add(sku)
    w = num(r[14])
    if w and w > 0:
        weights[sku] = round(w, 3)
    else:
        missing += 1

json.dump(weights, open("scripts/pawbol-weights.json", "w", encoding="utf-8"), ensure_ascii=False, indent=0)
print("SKU mit Gewicht:", len(weights), "| ohne Gewicht:", missing)
vals = sorted(weights.values())
if vals:
    print("kg min/median/max:", vals[0], vals[len(vals)//2], vals[-1])
