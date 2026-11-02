"""CPU-intensive synthetic fixture, never a replacement for production GA."""
import math
import time


def run(payload, progress):
    tenant_tag = payload["model"]["account_fixture_tag"]
    order_ids = [str(order["id"]) for order in payload["model"]["orders"]]
    duration = float(payload.get("test_cpu_seconds", 0.65))
    began = time.monotonic()
    next_mark = 0
    state = 1.5
    iterations = 0
    while time.monotonic() - began < duration:
        for idx in range(2200):
            state = math.sin(state + (idx % 7) / 77.0) + math.cos(state / 2.0)
        iterations += 1
        pct = min(99, int((time.monotonic() - began) / duration * 100))
        if pct >= next_mark:
            progress({"percent": pct, "best_preview": {"operations": [{"order": x} for x in order_ids], "tenant_tag": tenant_tag}})
            next_mark += 20
    return {"valid": True, "operations": [{"order": x} for x in order_ids],
            "tenant_tag": tenant_tag, "iterations": iterations, "checksum": round(state, 5)}
