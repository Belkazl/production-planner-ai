#!/usr/bin/env python3
"""Add a realistic, reviewable BOM to the exact public 12-order ceramics DEMO.
No API writes. All rules are examples, not measured factory consumption.
"""
import argparse
import copy
import json
from pathlib import Path

VERSION = "ceramics-material-consumption-2026-10-14-v1"
EXPECTED_IDS = tuple(range(2601, 2613))
SPEC = (
    # id, name, unit, rate per m2, consume at, initial stock, future arrival, arrival date
    ("M_BODY", "Пресс-порошок для керамогранита", "кг", 18.50, "OP_PRESS", 185000, 265000, "2026-10-07T08:00:00"),
    ("M_ENGOBE", "Ангоб", "кг", 0.55, "OP_GLAZE", 8000, 6000, "2026-10-08T09:00:00"),
    ("M_GLAZE", "Глазурь базовая", "кг", 0.65, "OP_GLAZE", 9000, 7500, "2026-10-07T09:00:00"),
    ("M_INK", "Краска для цифровой печати", "кг", 0.04, "OP_DECOR", 400, 600, "2026-10-08T09:00:00"),
    ("M_CARTONS", "Коробки для плитки", "шт.", 0.70, "OP_PACK", 10000, 8000, "2026-10-07T08:00:00"),
    ("M_PALLETS", "Палеты", "шт.", 0.02, "OP_PACK", 250, 250, "2026-10-08T08:00:00"),
)

def enrich(original: dict) -> dict:
    model = copy.deepcopy(original)
    orders = model.get("orders")
    processes = model.get("technical_processes")
    ids = tuple(sorted(o.get("id") for o in orders)) if isinstance(orders, list) else ()
    if len(ids) not in (6, 12) or len(set(ids)) != len(ids) or not set(ids).issubset(EXPECTED_IDS):
        raise ValueError("Expected the verified 6- or 12-order ceramic demo, not a customer model")
    if not isinstance(processes, list) or len(processes) != 1 or processes[0].get("id") != "TP_TILE":
        raise ValueError("Expected TP_TILE ceramic technology, refusing non-demo model")
    if model.get("_demo_materials_version") == VERSION:
        return model
    if model.get("materials") or model.get("material"):
        raise ValueError("Existing material data is not empty: refusing to overwrite it")
    op_map = {x.get("id"): x for x in processes[0].get("operations", [])}
    if not {"OP_PRESS", "OP_GLAZE", "OP_DECOR", "OP_PACK"}.issubset(op_map):
        raise ValueError("Demo operation identities changed")
    area = sum(float(o.get("area") or o.get("quantity") or 0) for o in orders)
    if not 0 < area <= 23100.0 or any(float(o.get("area") or 0) <= 0 for o in orders):
        raise ValueError("Unexpected ceramic demo area; refusing to overwrite production data")
    if any((o.get("parameters") or {}).get("mass_kg_m2") != 18 for o in orders):
        raise ValueError("The known ceramic demo mass specification is missing")
    if any(r.get("resource_type") == "material" for op in op_map.values()
           for r in op.get("resource_requirements", [])):
        raise ValueError("Material requirements already exist; refusing to duplicate them")
    material_list = []
    for material_id, name, unit, rate, operation_id, initial, delivery, at in SPEC:
        planned_demand = round(area * rate, 5)
        if initial + delivery < planned_demand:
            raise ValueError("Insufficient example stock for " + material_id)
        material_list.append({
            "id": material_id, "name": name, "unit": unit,
            "initial_stock": initial,
            "deliveries": [{"at": at, "quantity": delivery}],
            "consumption_per_unit": rate,
            "order_ids": [o["id"] for o in orders],
            "_demo_planned_demand": planned_demand,
        })
        requirement = {
            "id": "RR_" + material_id,
            "resource_type": "material",
            "type": "material",
            "match_mode": "specific",
            "resource_ref": material_id,
            "resource_refs": [material_id],
            "quantity": rate,
            "unit": unit,
            "consumption_rule": "per_m2",
        }
        op = op_map[operation_id]
        reqs = op.setdefault("resource_requirements", [])
        if any(r.get("id") == requirement["id"] for r in reqs):
            raise ValueError("Material requirement already exists in " + operation_id)
        reqs.append(requirement)
    model["materials"] = material_list
    model["_demo_materials_version"] = VERSION
    return model

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    payload = json.loads(Path(args.input).read_text(encoding="utf-8"))
    wrapped = isinstance(payload, dict) and isinstance(payload.get("model"), dict)
    model = payload["model"] if wrapped else payload
    enriched = enrich(model)
    out = {**payload, "model": enriched} if wrapped else enriched
    Path(args.output).write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print("CERAMICS_MATERIAL_DEMO_BUILD_PASS",json.dumps({
        "orders": len(enriched["orders"]),
        "materials": len(enriched["materials"]),
        "requirements": sum(len(x["resource_requirements"]) for x in enriched["technical_processes"][0]["operations"]),
        "volume_m2": sum(float(o.get("area") or o.get("quantity") or 0) for o in enriched["orders"]),
        "material_ids": [m["id"] for m in enriched["materials"]],
    },ensure_ascii=False),flush=True)

if __name__ == "__main__":
    main()
