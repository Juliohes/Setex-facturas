#!/usr/bin/env python3
"""
SETEX FACTURAS — STRESS TEST PROFESIONAL
Simula un trimestral con muchas facturas simultáneas.
Mide latencia, throughput, tasa de éxito y uso de recursos.
"""
import os
import sys
import json
import time
import statistics
import subprocess
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed
from urllib.request import Request, urlopen
from urllib.parse import urlencode
from urllib.error import HTTPError, URLError
import mimetypes

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
INVOICE_DIR = os.path.join(SCRIPT_DIR, 'invoices')
RESULTS_DIR = os.path.join(SCRIPT_DIR, 'results')
os.makedirs(RESULTS_DIR, exist_ok=True)

# API directa al backend (sin Traefik = sin rate limits = test puro OCR)
API_URL = os.environ.get('API_URL', 'http://172.18.0.5:3000/api')
EMAIL = os.environ.get('TEST_EMAIL', 'juliohesuni@gmail.com')
PASSWORD = os.environ.get('TEST_PASSWORD', 'test1234')


def api_post_json(path, data):
    """POST JSON request."""
    body = json.dumps(data).encode('utf-8')
    req = Request(f"{API_URL}{path}", data=body, method='POST')
    req.add_header('Content-Type', 'application/json')
    try:
        with urlopen(req, timeout=15) as resp:
            return json.loads(resp.read())
    except HTTPError as e:
        return json.loads(e.read()) if e.fp else {"error": str(e)}


def api_upload(path, filepath, token):
    """Multipart file upload via curl (more reliable than urllib for multipart)."""
    cmd = [
        'curl', '-s', '-X', 'POST', f"{API_URL}{path}",
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
    """Autenticar y obtener token."""
    result = api_post_json('/auth/login', {'email': EMAIL, 'password': PASSWORD})
    token = result.get('token')
    if not token:
        print(f"  ERROR LOGIN: {result}")
        sys.exit(1)
    return token


def upload_invoice(filepath, token, idx):
    """Sube una factura y mide el tiempo."""
    filename = os.path.basename(filepath)
    start = time.time()
    try:
        result = api_upload('/upload', filepath, token)
        elapsed = time.time() - start

        status = 'error'
        if result.get('success'):
            status = 'ok'
        elif result.get('duplicate'):
            status = 'duplicate'
        elif result.get('missing_fields'):
            status = 'missing'

        return {
            'idx': idx,
            'filename': filename,
            'status': status,
            'elapsed_s': round(elapsed, 2),
            'error': result.get('error', ''),
            'success': result.get('success', False),
        }
    except Exception as e:
        elapsed = time.time() - start
        return {
            'idx': idx,
            'filename': filename,
            'status': 'error',
            'elapsed_s': round(elapsed, 2),
            'error': str(e),
            'success': False,
        }


def get_system_stats():
    """Obtener estadísticas del sistema."""
    try:
        mem = subprocess.run(['free', '-m'], capture_output=True, text=True)
        lines = mem.stdout.strip().split('\n')
        mem_parts = lines[1].split()
        total_mb = int(mem_parts[1])
        used_mb = int(mem_parts[2])

        docker = subprocess.run(
            ['docker', 'stats', '--no-stream', '--format', '{{.Name}}\t{{.MemUsage}}\t{{.CPUPerc}}'],
            capture_output=True, text=True
        )
        return {
            'ram_total_mb': total_mb,
            'ram_used_mb': used_mb,
            'ram_pct': round(used_mb / total_mb * 100, 1),
            'docker': docker.stdout.strip()
        }
    except:
        return {}


def run_test(invoices, concurrency, token, label):
    """Ejecuta un test con la concurrencia indicada."""
    print(f"\n  {'='*60}")
    print(f"  TEST: {label}")
    print(f"  Facturas: {len(invoices)} | Concurrencia: {concurrency}")
    print(f"  {'='*60}\n")

    results = []
    start_total = time.time()

    if concurrency == 1:
        # Secuencial
        for i, inv_path in enumerate(invoices):
            r = upload_invoice(inv_path, token, i)
            results.append(r)
            icon = '\033[92mOK\033[0m' if r['status'] == 'ok' else (
                '\033[93mDUP\033[0m' if r['status'] == 'duplicate' else (
                    '\033[93mMIS\033[0m' if r['status'] == 'missing' else '\033[91mERR\033[0m'
                ))
            print(f"    {icon}  {r['filename']}  {r['elapsed_s']}s  {r['error'][:60] if r['error'] else ''}")
    else:
        # Concurrente
        with ThreadPoolExecutor(max_workers=concurrency) as executor:
            futures = {}
            for i, inv_path in enumerate(invoices):
                f = executor.submit(upload_invoice, inv_path, token, i)
                futures[f] = inv_path

            for f in as_completed(futures):
                r = f.result()
                results.append(r)
                icon = '\033[92mOK\033[0m' if r['status'] == 'ok' else (
                    '\033[93mDUP\033[0m' if r['status'] == 'duplicate' else (
                        '\033[93mMIS\033[0m' if r['status'] == 'missing' else '\033[91mERR\033[0m'
                    ))
                print(f"    {icon}  {r['filename']}  {r['elapsed_s']}s  {r['error'][:60] if r['error'] else ''}")

    total_time = time.time() - start_total
    return results, total_time


def print_summary(all_results, test_configs):
    """Imprime resumen profesional."""
    stats_post = get_system_stats()

    print("\n")
    print("  " + "="*66)
    print("       SETEX FACTURAS — INFORME DE STRESS TEST")
    print("  " + "="*66)
    print()
    print("  ENTORNO:")
    print("    Servidor:       KVM 2 (2 vCPU, 8 GB RAM)")
    print("    OCR Engine:     OpenAI GPT-4.1 (json_schema strict)")
    print("    Backend:        Node.js 20 (Docker, 0.5 CPU, 512 MB)")
    print("    Worker BullMQ:  concurrency 2, retries 3")
    if stats_post:
        print(f"    RAM post-test:  {stats_post.get('ram_used_mb', '?')} MB / {stats_post.get('ram_total_mb', '?')} MB ({stats_post.get('ram_pct', '?')}%)")
    print()

    for label, results, total_time, concurrency in test_configs:
        ok = [r for r in results if r['status'] == 'ok']
        dup = [r for r in results if r['status'] == 'duplicate']
        mis = [r for r in results if r['status'] == 'missing']
        err = [r for r in results if r['status'] == 'error']

        times = [r['elapsed_s'] for r in results if r['elapsed_s'] > 0]
        ok_times = [r['elapsed_s'] for r in ok]

        print(f"  {'-'*66}")
        print(f"  {label}")
        print(f"  {'-'*66}")
        print(f"    Facturas enviadas:    {len(results)}")
        print(f"    Concurrencia:         {concurrency}")
        print(f"    Tiempo total:         {total_time:.1f}s")
        print()
        print(f"    Exitosas (OK):        {len(ok)}")
        print(f"    Duplicadas:           {len(dup)}")
        print(f"    Campos faltantes:     {len(mis)}")
        print(f"    Errores:              {len(err)}")
        if len(results) > 0:
            success_rate = len(ok) / max(len(ok) + len(err), 1) * 100
            print(f"    Tasa de exito:        {success_rate:.0f}%")
        print()

        if ok_times:
            print(f"    Latencia (facturas OK):")
            print(f"      Minima:             {min(ok_times):.2f}s")
            print(f"      Media:              {statistics.mean(ok_times):.2f}s")
            if len(ok_times) >= 2:
                print(f"      Mediana:            {statistics.median(ok_times):.2f}s")
            if len(ok_times) >= 20:
                p95_idx = int(len(ok_times) * 0.95)
                sorted_times = sorted(ok_times)
                print(f"      P95:                {sorted_times[p95_idx]:.2f}s")
            print(f"      Maxima:             {max(ok_times):.2f}s")
            print()

            if total_time > 0:
                throughput = len(ok) / total_time * 60
                print(f"    Throughput:            {throughput:.1f} facturas OK/minuto")

        if times:
            avg_time = statistics.mean(times)
            print()
            print(f"    PROYECCION (basado en media de {avg_time:.1f}s/factura):")
            for n in [50, 100, 500]:
                if concurrency > 1:
                    proj_s = n * avg_time / concurrency
                else:
                    proj_s = n * avg_time
                if proj_s > 60:
                    print(f"      {n} facturas:        ~{proj_s/60:.0f} minutos")
                else:
                    print(f"      {n} facturas:        ~{proj_s:.0f} segundos")

        print()

    # Docker stats
    if stats_post and stats_post.get('docker'):
        print(f"  {'-'*66}")
        print("  ESTADO DEL SERVIDOR POST-TEST:")
        print(f"  {'-'*66}")
        for line in stats_post['docker'].split('\n'):
            if 'setex' in line:
                print(f"    {line}")
        print()

    print("  " + "="*66)
    print()


def main():
    concurrency = int(sys.argv[1]) if len(sys.argv) > 1 else 1
    total = int(sys.argv[2]) if len(sys.argv) > 2 else 5

    print()
    print("  " + "="*60)
    print("    SETEX FACTURAS — STRESS TEST PROFESIONAL")
    print("  " + "="*60)
    print(f"  API:            {API_URL}")
    print(f"  Total facturas: {total}")
    print(f"  Concurrencia:   {concurrency}")

    # Verificar facturas
    invoice_files = sorted([
        os.path.join(INVOICE_DIR, f) for f in os.listdir(INVOICE_DIR)
        if f.endswith('.jpg')
    ])
    if not invoice_files:
        print(f"\n  ERROR: No hay facturas en {INVOICE_DIR}")
        print("  Ejecuta: python3 tests/generate-invoices.py 30")
        sys.exit(1)

    print(f"  Facturas disponibles: {len(invoice_files)}")

    # Seleccionar facturas (repetir si hace falta)
    selected = []
    while len(selected) < total:
        selected.extend(invoice_files)
    selected = selected[:total]

    # Login
    print(f"\n  Autenticando como {EMAIL}...")
    token = login()
    print("  Login OK")

    # RAM antes del test
    stats_pre = get_system_stats()
    if stats_pre:
        print(f"  RAM antes: {stats_pre.get('ram_used_mb', '?')} MB / {stats_pre.get('ram_total_mb', '?')} MB")

    # Ejecutar test
    all_configs = []

    if concurrency == 1 and total <= 10:
        # Solo test secuencial
        results, total_time = run_test(selected, 1, token, f"SECUENCIAL ({total} facturas)")
        all_configs.append((f"SECUENCIAL ({total} facturas)", results, total_time, 1))
    elif total > 10:
        # Primero 3 secuenciales para baseline
        print("\n  Fase 1: Baseline secuencial (3 facturas)...")
        baseline_results, baseline_time = run_test(selected[:3], 1, token, "BASELINE SECUENCIAL (3 facturas)")
        all_configs.append(("BASELINE SECUENCIAL (3 facturas)", baseline_results, baseline_time, 1))

        # Luego el test concurrente completo
        remaining = selected[3:]
        if remaining:
            print(f"\n  Fase 2: Test concurrente ({len(remaining)} facturas, x{concurrency})...")
            conc_results, conc_time = run_test(remaining, concurrency, token, f"CONCURRENTE x{concurrency} ({len(remaining)} facturas)")
            all_configs.append((f"CONCURRENTE x{concurrency} ({len(remaining)} facturas)", conc_results, conc_time, concurrency))
    else:
        results, total_time = run_test(selected, concurrency, token, f"CONCURRENTE x{concurrency} ({total} facturas)")
        all_configs.append((f"CONCURRENTE x{concurrency} ({total} facturas)", results, total_time, concurrency))

    # Resumen
    print_summary(
        [r for _, results, _, _ in all_configs for r in results],
        all_configs
    )

    # Guardar CSV
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    csv_path = os.path.join(RESULTS_DIR, f'stress_{timestamp}.csv')
    with open(csv_path, 'w') as f:
        f.write('test,filename,status,elapsed_s,error\n')
        for label, results, _, _ in all_configs:
            for r in results:
                error_clean = r['error'].replace(',', ';')[:80]
                f.write(f"{label},{r['filename']},{r['status']},{r['elapsed_s']},{error_clean}\n")

    print(f"  Resultados guardados: {csv_path}")
    print()


if __name__ == '__main__':
    main()
