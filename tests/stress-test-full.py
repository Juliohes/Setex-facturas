#!/usr/bin/env python3
"""
SETEX FACTURAS — STRESS TEST COMPLETO & MÉTRICAS PROFESIONALES
==============================================================
Ejecuta batería completa de tests con diferentes niveles de concurrencia.
Genera informe detallado con métricas, proyecciones y recomendaciones.

Uso: python3 tests/stress-test-full.py
"""
import os
import sys
import json
import time
import statistics
import subprocess
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
INVOICE_DIR = os.path.join(SCRIPT_DIR, 'invoices')
RESULTS_DIR = os.path.join(SCRIPT_DIR, 'results')
os.makedirs(RESULTS_DIR, exist_ok=True)

# API directa al backend (sin Traefik)
API_URL = os.environ.get('API_URL', 'http://172.18.0.5:3000/api')
EMAIL = os.environ.get('TEST_EMAIL', 'juliohesuni@gmail.com')
PASSWORD = os.environ.get('TEST_PASSWORD', 'test1234')

# Test scenarios: (concurrency, num_invoices, label)
SCENARIOS = [
    (1,  5,  "Secuencial (baseline)"),
    (3,  9,  "Concurrencia x3"),
    (5,  15, "Concurrencia x5"),
    (10, 20, "Concurrencia x10"),
    (15, 15, "Concurrencia x15"),
    (20, 20, "Concurrencia x20"),
]


def api_post_json(path, data):
    body = json.dumps(data).encode('utf-8')
    from urllib.request import Request, urlopen
    from urllib.error import HTTPError
    req = Request(f"{API_URL}{path}", data=body, method='POST')
    req.add_header('Content-Type', 'application/json')
    try:
        with urlopen(req, timeout=15) as resp:
            return json.loads(resp.read())
    except HTTPError as e:
        return json.loads(e.read()) if e.fp else {"error": str(e)}


def api_upload(filepath, token):
    cmd = [
        'curl', '-s', '-X', 'POST', f"{API_URL}/upload",
        '-H', f'Authorization: Bearer {token}',
        '-F', f'file=@{filepath}',
        '--max-time', '120'
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=130)
    try:
        return json.loads(result.stdout)
    except:
        return {"error": f"Parse error: {result.stdout[:200]}"}


def login():
    result = api_post_json('/auth/login', {'email': EMAIL, 'password': PASSWORD})
    token = result.get('token')
    if not token:
        print(f"  ERROR LOGIN: {result}")
        sys.exit(1)
    return token


def upload_invoice(filepath, token, idx):
    filename = os.path.basename(filepath)
    start = time.time()
    try:
        result = api_upload(filepath, token)
        elapsed = time.time() - start

        status = 'error'
        if result.get('success'):
            status = 'ok'
        elif result.get('duplicate'):
            status = 'duplicate'
        elif result.get('missing_fields'):
            status = 'missing'
        elif 'Demasiados' in str(result.get('error', '')):
            status = 'rate_limited'

        return {
            'idx': idx,
            'filename': filename,
            'status': status,
            'elapsed_s': round(elapsed, 2),
            'error': result.get('error', ''),
            'success': result.get('success', False),
            'ocr_engine': result.get('ocr_engine', ''),
            'ocr_time': result.get('processing_time_s', 0),
            'confidence': result.get('confidence', 0),
        }
    except Exception as e:
        elapsed = time.time() - start
        return {
            'idx': idx, 'filename': filename, 'status': 'error',
            'elapsed_s': round(elapsed, 2), 'error': str(e),
            'success': False, 'ocr_engine': '', 'ocr_time': 0, 'confidence': 0,
        }


def get_system_stats():
    try:
        mem = subprocess.run(['free', '-m'], capture_output=True, text=True)
        lines = mem.stdout.strip().split('\n')
        mem_parts = lines[1].split()
        total_mb = int(mem_parts[1])
        used_mb = int(mem_parts[2])
        avail_mb = int(mem_parts[6]) if len(mem_parts) > 6 else total_mb - used_mb

        swap_parts = lines[2].split() if len(lines) > 2 else []
        swap_total = int(swap_parts[1]) if swap_parts else 0
        swap_used = int(swap_parts[2]) if swap_parts else 0

        docker = subprocess.run(
            ['docker', 'stats', '--no-stream', '--format', '{{.Name}}\t{{.MemUsage}}\t{{.CPUPerc}}'],
            capture_output=True, text=True
        )
        return {
            'ram_total_mb': total_mb,
            'ram_used_mb': used_mb,
            'ram_avail_mb': avail_mb,
            'ram_pct': round(used_mb / total_mb * 100, 1),
            'swap_total_mb': swap_total,
            'swap_used_mb': swap_used,
            'docker': docker.stdout.strip()
        }
    except:
        return {}


def run_scenario(invoices, concurrency, token, label):
    print(f"\n  {'='*60}")
    print(f"  {label}")
    print(f"  Facturas: {len(invoices)} | Workers: {concurrency}")
    print(f"  {'='*60}")

    stats_pre = get_system_stats()
    results = []
    start_total = time.time()

    if concurrency == 1:
        for i, inv_path in enumerate(invoices):
            r = upload_invoice(inv_path, token, i)
            results.append(r)
            icon = '\033[92mOK\033[0m' if r['status'] == 'ok' else (
                '\033[93mDUP\033[0m' if r['status'] == 'duplicate' else '\033[91mERR\033[0m')
            print(f"    {icon}  {r['filename']}  {r['elapsed_s']}s  {r.get('ocr_engine','')}  {r['error'][:50] if r['error'] else ''}")
    else:
        with ThreadPoolExecutor(max_workers=concurrency) as executor:
            futures = {}
            for i, inv_path in enumerate(invoices):
                f = executor.submit(upload_invoice, inv_path, token, i)
                futures[f] = inv_path
            for f in as_completed(futures):
                r = f.result()
                results.append(r)
                icon = '\033[92mOK\033[0m' if r['status'] == 'ok' else (
                    '\033[93mDUP\033[0m' if r['status'] == 'duplicate' else '\033[91mERR\033[0m')
                print(f"    {icon}  {r['filename']}  {r['elapsed_s']}s  {r.get('ocr_engine','')}  {r['error'][:50] if r['error'] else ''}")

    total_time = time.time() - start_total
    stats_post = get_system_stats()

    return {
        'label': label,
        'concurrency': concurrency,
        'results': results,
        'total_time_s': round(total_time, 2),
        'stats_pre': stats_pre,
        'stats_post': stats_post,
    }


def compute_metrics(scenario):
    results = scenario['results']
    total_time = scenario['total_time_s']
    conc = scenario['concurrency']

    ok = [r for r in results if r['status'] == 'ok']
    dup = [r for r in results if r['status'] == 'duplicate']
    mis = [r for r in results if r['status'] == 'missing']
    err = [r for r in results if r['status'] == 'error']
    rl = [r for r in results if r['status'] == 'rate_limited']

    ok_times = sorted([r['elapsed_s'] for r in ok]) if ok else []
    all_times = sorted([r['elapsed_s'] for r in results]) if results else []

    metrics = {
        'total_sent': len(results),
        'ok': len(ok),
        'duplicate': len(dup),
        'missing': len(mis),
        'error': len(err),
        'rate_limited': len(rl),
        'success_rate': round(len(ok) / max(len(ok) + len(err) + len(rl), 1) * 100, 1),
        'total_time_s': total_time,
        'concurrency': conc,
    }

    if ok_times:
        metrics['latency'] = {
            'min': ok_times[0],
            'mean': round(statistics.mean(ok_times), 2),
            'median': round(statistics.median(ok_times), 2) if len(ok_times) >= 2 else ok_times[0],
            'p90': round(ok_times[int(len(ok_times) * 0.9)], 2) if len(ok_times) >= 10 else None,
            'p95': round(ok_times[int(len(ok_times) * 0.95)], 2) if len(ok_times) >= 20 else None,
            'p99': round(ok_times[int(len(ok_times) * 0.99)], 2) if len(ok_times) >= 100 else None,
            'max': ok_times[-1],
            'stdev': round(statistics.stdev(ok_times), 2) if len(ok_times) >= 2 else 0,
        }
        metrics['throughput_per_min'] = round(len(ok) / total_time * 60, 1) if total_time > 0 else 0
        metrics['effective_rps'] = round(len(ok) / total_time, 2) if total_time > 0 else 0

        # OCR-specific metrics
        ocr_times = [r['ocr_time'] for r in ok if r.get('ocr_time')]
        if ocr_times:
            metrics['ocr_latency'] = {
                'min': round(min(ocr_times), 2),
                'mean': round(statistics.mean(ocr_times), 2),
                'max': round(max(ocr_times), 2),
            }

        confs = [r['confidence'] for r in ok if r.get('confidence')]
        if confs:
            metrics['ocr_confidence'] = {
                'min': round(min(confs), 3),
                'mean': round(statistics.mean(confs), 3),
                'max': round(max(confs), 3),
            }
    else:
        metrics['latency'] = None
        metrics['throughput_per_min'] = 0
        metrics['effective_rps'] = 0

    return metrics


def generate_report(all_scenarios, all_metrics, timestamp):
    lines = []
    w = lines.append

    w("")
    w("=" * 80)
    w("   SETEX FACTURAS — INFORME COMPLETO DE CAPACIDAD Y RENDIMIENTO")
    w(f"   Fecha: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    w("=" * 80)
    w("")

    # System info
    w("  ENTORNO DE PRUEBAS")
    w("  " + "-" * 70)
    w("    Servidor:           Hostinger KVM 2 (2 vCPU, 8 GB RAM, 100 GB NVMe)")
    w("    Sistema:            Ubuntu 24.04 LTS")
    w("    Backend:            Node.js 20 (Docker, 0.5 CPU, 512 MB RAM limit)")
    w("    Base de datos:      PostgreSQL 15 (Docker, 0.5 CPU, 512 MB)")
    w("    Cola:               BullMQ + Redis 7 (concurrency 2)")
    w("    OCR Engine:         OpenAI GPT-4.1 (json_schema strict mode)")
    w("    Optimizacion img:   Sharp (resize 1536px, JPEG 85%)")
    w("    Swap:               4 GB activo")
    w("")

    # Summary table
    w("  RESUMEN POR ESCENARIO")
    w("  " + "-" * 70)
    w(f"  {'Escenario':<30} {'OK':>4} {'Err':>4} {'%OK':>6} {'Media':>7} {'P50':>7} {'Max':>7} {'F/min':>7}")
    w("  " + "-" * 70)

    for sc, m in zip(all_scenarios, all_metrics):
        lat = m.get('latency') or {}
        w(f"  {sc['label']:<30} {m['ok']:>4} {m['error']:>4} {m['success_rate']:>5.0f}% {lat.get('mean','N/A'):>6}s {lat.get('median','N/A'):>6}s {lat.get('max','N/A'):>6}s {m['throughput_per_min']:>6.0f}")

    w("  " + "-" * 70)
    w("")

    # Detailed per-scenario
    for sc, m in zip(all_scenarios, all_metrics):
        w(f"  {'=' * 70}")
        w(f"  {sc['label'].upper()}")
        w(f"  {'=' * 70}")
        w(f"    Facturas enviadas:     {m['total_sent']}")
        w(f"    Concurrencia:          {m['concurrency']}")
        w(f"    Tiempo total:          {m['total_time_s']}s")
        w("")
        w(f"    Resultados:")
        w(f"      Exitosas (OK):       {m['ok']}")
        w(f"      Duplicadas:          {m['duplicate']}")
        w(f"      Campos faltantes:    {m['missing']}")
        w(f"      Errores:             {m['error']}")
        w(f"      Rate limited:        {m['rate_limited']}")
        w(f"      Tasa de exito:       {m['success_rate']}%")
        w("")

        if m['latency']:
            lat = m['latency']
            w(f"    Latencia (facturas OK):")
            w(f"      Minima:              {lat['min']}s")
            w(f"      Media:               {lat['mean']}s")
            w(f"      Mediana (P50):       {lat['median']}s")
            if lat.get('p90'): w(f"      P90:                 {lat['p90']}s")
            if lat.get('p95'): w(f"      P95:                 {lat['p95']}s")
            if lat.get('p99'): w(f"      P99:                 {lat['p99']}s")
            w(f"      Maxima:              {lat['max']}s")
            w(f"      Desviacion std:      {lat['stdev']}s")
            w("")
            w(f"    Throughput:")
            w(f"      Facturas OK/minuto:  {m['throughput_per_min']}")
            w(f"      Requests/segundo:    {m['effective_rps']}")

        if m.get('ocr_latency'):
            ol = m['ocr_latency']
            w(f"    OCR (solo procesamiento):")
            w(f"      Min:                 {ol['min']}s")
            w(f"      Media:               {ol['mean']}s")
            w(f"      Max:                 {ol['max']}s")

        if m.get('ocr_confidence'):
            oc = m['ocr_confidence']
            w(f"    Confianza OCR:")
            w(f"      Min:                 {oc['min']}")
            w(f"      Media:               {oc['mean']}")
            w(f"      Max:                 {oc['max']}")

        # System resources
        sp = sc.get('stats_post', {})
        if sp:
            w(f"    Recursos post-test:")
            w(f"      RAM:                 {sp.get('ram_used_mb','?')} MB / {sp.get('ram_total_mb','?')} MB ({sp.get('ram_pct','?')}%)")
            w(f"      Swap:                {sp.get('swap_used_mb','?')} MB / {sp.get('swap_total_mb','?')} MB")

        w("")

    # Projections
    w("  " + "=" * 70)
    w("  PROYECCIONES DE CAPACIDAD")
    w("  " + "=" * 70)
    w("")

    # Use the best concurrent scenario for projections
    best = None
    for m in all_metrics:
        if m['throughput_per_min'] > 0:
            if best is None or m['throughput_per_min'] > best['throughput_per_min']:
                best = m

    if best and best['latency']:
        avg = best['latency']['mean']
        thr = best['throughput_per_min']
        conc = best['concurrency']

        w(f"    Basado en el mejor escenario: {thr:.0f} facturas/min (concurrencia {conc})")
        w("")
        w(f"    {'Facturas':<12} {'Tiempo estimado':<20} {'Facturas/hora':>15}")
        w(f"    {'-'*50}")
        for n in [10, 25, 50, 100, 200, 500, 1000]:
            est_s = n / (thr / 60)
            if est_s > 3600:
                est_str = f"~{est_s/3600:.1f} horas"
            elif est_s > 60:
                est_str = f"~{est_s/60:.0f} minutos"
            else:
                est_str = f"~{est_s:.0f} segundos"
            fph = round(thr * 60)
            w(f"    {n:<12} {est_str:<20} {fph:>15,}")

        w("")
        w("  ESCENARIOS DE USO REAL")
        w("  " + "-" * 70)
        w(f"    Dia normal (20-50 facturas):       ~{50/(thr/60)/60:.0f} minutos")
        w(f"    Cierre mensual (100-200 facturas):  ~{200/(thr/60)/60:.0f} minutos")
        w(f"    Pico trimestral (500+ facturas):    ~{500/(thr/60)/60:.0f} minutos")
        w(f"    Carga masiva (1000 facturas):       ~{1000/(thr/60)/3600:.1f} horas")

    w("")

    # Docker stats
    last_stats = all_scenarios[-1].get('stats_post', {})
    if last_stats.get('docker'):
        w("  ESTADO DEL SERVIDOR POST-TEST")
        w("  " + "-" * 70)
        for line in last_stats['docker'].split('\n'):
            if 'setex' in line.lower():
                w(f"    {line}")
        w("")

    w("=" * 80)
    w("")

    return '\n'.join(lines)


def main():
    print()
    print("  " + "=" * 60)
    print("    SETEX FACTURAS — STRESS TEST COMPLETO")
    print("    Bateria de 6 escenarios de concurrencia")
    print("  " + "=" * 60)
    print(f"  API: {API_URL}")

    # Check invoices
    invoice_files = sorted([
        os.path.join(INVOICE_DIR, f) for f in os.listdir(INVOICE_DIR)
        if f.endswith('.jpg')
    ])
    if len(invoice_files) < 20:
        print(f"\n  ERROR: Necesitas al menos 20 facturas. Tienes {len(invoice_files)}")
        print("  Ejecuta: python3 tests/generate-invoices.py 60")
        sys.exit(1)

    print(f"  Facturas disponibles: {len(invoice_files)}")

    # Login
    print(f"\n  Autenticando como {EMAIL}...")
    token = login()
    print("  Login OK")

    # Initial stats
    stats_init = get_system_stats()
    if stats_init:
        print(f"  RAM inicial: {stats_init.get('ram_used_mb','?')} MB / {stats_init.get('ram_total_mb','?')} MB ({stats_init.get('ram_pct','?')}%)")

    all_scenarios = []
    all_metrics = []
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    invoice_idx = 0

    for conc, n_invoices, label in SCENARIOS:
        # Select unique invoices for this scenario (cycle if needed)
        selected = []
        for i in range(n_invoices):
            selected.append(invoice_files[(invoice_idx + i) % len(invoice_files)])
        invoice_idx += n_invoices

        scenario = run_scenario(selected, conc, token, label)
        metrics = compute_metrics(scenario)

        all_scenarios.append(scenario)
        all_metrics.append(metrics)

        # Brief pause between scenarios to let system settle
        if conc < 20:
            print(f"\n  Pausa 5s antes del siguiente escenario...")
            time.sleep(5)

    # Generate report
    report = generate_report(all_scenarios, all_metrics, timestamp)
    print(report)

    # Save report to file
    report_path = os.path.join(RESULTS_DIR, f'stress_full_{timestamp}.txt')
    with open(report_path, 'w') as f:
        # Strip ANSI color codes for file output
        import re
        clean = re.sub(r'\033\[\d+m', '', report)
        f.write(clean)

    # Save detailed JSON
    json_path = os.path.join(RESULTS_DIR, f'stress_full_{timestamp}.json')
    json_data = {
        'timestamp': timestamp,
        'environment': {
            'server': 'Hostinger KVM 2',
            'cpu': '2 vCPU',
            'ram': '8 GB',
            'backend_limit': '0.5 CPU, 512 MB',
            'ocr_engine': 'OpenAI GPT-4.1',
            'queue': 'BullMQ concurrency 2',
        },
        'scenarios': []
    }
    for sc, m in zip(all_scenarios, all_metrics):
        json_data['scenarios'].append({
            'label': sc['label'],
            'concurrency': sc['concurrency'],
            'total_time_s': sc['total_time_s'],
            'metrics': m,
            'individual_results': sc['results'],
        })

    with open(json_path, 'w') as f:
        json.dump(json_data, f, indent=2, default=str)

    # Save CSV
    csv_path = os.path.join(RESULTS_DIR, f'stress_full_{timestamp}.csv')
    with open(csv_path, 'w') as f:
        f.write('scenario,concurrency,filename,status,elapsed_s,ocr_engine,ocr_time,confidence,error\n')
        for sc in all_scenarios:
            for r in sc['results']:
                err = str(r.get('error', '')).replace(',', ';')[:80]
                f.write(f"{sc['label']},{sc['concurrency']},{r['filename']},{r['status']},{r['elapsed_s']},{r.get('ocr_engine','')},{r.get('ocr_time',0)},{r.get('confidence',0)},{err}\n")

    print(f"\n  Archivos guardados:")
    print(f"    Informe:  {report_path}")
    print(f"    JSON:     {json_path}")
    print(f"    CSV:      {csv_path}")
    print()


if __name__ == '__main__':
    main()
