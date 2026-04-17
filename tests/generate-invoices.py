#!/usr/bin/env python3
"""
Generador de facturas españolas realistas para stress testing.
Crea imágenes PNG con datos fiscales válidos que GPT-4.1 puede leer.
Usa Pillow para renderizar texto sobre fondo blanco.
"""
import os
import random
import sys
from datetime import datetime, timedelta

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    print("ERROR: pip install Pillow")
    sys.exit(1)

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), 'invoices')
os.makedirs(OUTPUT_DIR, exist_ok=True)

# ── Datos realistas de empresas españolas ──────────────────────────────────────
EMPRESAS = [
    {"nombre": "CONSTRUCCIONES MARTINEZ HERMANOS S.L.", "cif": "B86432901", "dir": "C/ Gran Vía 45, 28013 Madrid"},
    {"nombre": "TRANSPORTES GARCIA NAVARRO S.A.", "cif": "A28017895", "dir": "Av. de Andalucía 12, 41018 Sevilla"},
    {"nombre": "FONTANERIA LOPEZ E HIJOS S.L.", "cif": "B63904291", "dir": "C/ Valencia 78, 08015 Barcelona"},
    {"nombre": "ELECTRICIDAD SANCHEZ INSTALACIONES S.L.", "cif": "B29384756", "dir": "C/ Alameda 33, 29001 Málaga"},
    {"nombre": "SUMINISTROS INDUSTRIALES DEL NORTE S.A.", "cif": "A80308266", "dir": "Polígono Ind. Asipo, 33428 Llanera, Asturias"},
    {"nombre": "ASESORIA FISCAL PEREZ Y ASOCIADOS S.L.", "cif": "B65037901", "dir": "Rambla Catalunya 56, 08007 Barcelona"},
    {"nombre": "CLINICA DENTAL SONRISA SANA S.L.", "cif": "B43012856", "dir": "C/ Doctor Fleming 8, 43001 Tarragona"},
    {"nombre": "RESTAURANTE EL BUEN SABOR S.L.", "cif": "B78234561", "dir": "C/ Serrano 120, 28006 Madrid"},
    {"nombre": "AUTOESCUELA VELOZ FORMACION S.L.", "cif": "B91827364", "dir": "Av. de la Constitución 15, 18012 Granada"},
    {"nombre": "TALLER MECANICO RODRIGUEZ AUTO S.L.", "cif": "B54329018", "dir": "C/ Industria 22, 46920 Mislata, Valencia"},
    {"nombre": "CARPINTERIA MADERA NOBLE S.L.", "cif": "B36789012", "dir": "C/ do Franco 44, 36002 Pontevedra"},
    {"nombre": "INFORMATICA SOLUCIONES TECH S.L.", "cif": "B81234509", "dir": "C/ Alcalá 200, 28028 Madrid"},
    {"nombre": "FERRETERIA CENTRAL EL CLAVO S.L.", "cif": "B47890123", "dir": "C/ Mayor 7, 47001 Valladolid"},
    {"nombre": "LIMPIEZA PROFESIONAL BRILLO S.L.", "cif": "B50123467", "dir": "C/ Independencia 30, 50004 Zaragoza"},
    {"nombre": "PINTURAS Y DECORACION COLORES S.L.", "cif": "B15678903", "dir": "C/ Real 18, 15001 A Coruña"},
    {"nombre": "JARDINERIA VERDE NATURA S.L.", "cif": "B41098712", "dir": "C/ Betis 51, 41010 Sevilla"},
    {"nombre": "MUDANZAS RAPIDAS EXPRESS S.L.", "cif": "B08567123", "dir": "C/ Aragó 312, 08009 Barcelona"},
    {"nombre": "CRISTALERIA VIDRIO CLARO S.L.", "cif": "B30456789", "dir": "C/ Trapería 20, 30001 Murcia"},
    {"nombre": "REFORMAS INTEGRALES HOGAR S.L.", "cif": "B48901235", "dir": "Alameda Mazarredo 6, 48009 Bilbao"},
    {"nombre": "SEGURIDAD VIGILANCIA TOTAL S.A.", "cif": "A33567812", "dir": "C/ Uría 58, 33003 Oviedo"},
]

RECEPTORES = [
    {"nombre": "SETEX ASESORIA FISCAL S.L.", "cif": "B12398745"},
    {"nombre": "GESTION CONTABLE NORTE S.L.", "cif": "B98712340"},
    {"nombre": "ADMINISTRACIONES GARCIA S.L.", "cif": "B45678120"},
]

CONCEPTOS = [
    ("Servicio de mantenimiento mensual", (200, 800)),
    ("Reparación e instalación eléctrica", (150, 1500)),
    ("Suministro de materiales de construcción", (500, 5000)),
    ("Servicio de transporte de mercancías", (300, 2000)),
    ("Consultoría y asesoramiento fiscal", (250, 1200)),
    ("Trabajos de fontanería y saneamiento", (180, 900)),
    ("Servicio de limpieza profesional", (400, 1500)),
    ("Suministro e instalación de cristales", (350, 2500)),
    ("Reforma integral de local comercial", (2000, 15000)),
    ("Mantenimiento de jardines y zonas verdes", (150, 600)),
    ("Servicio de vigilancia y seguridad", (800, 3000)),
    ("Reparación y mantenimiento de vehículos", (100, 1800)),
    ("Suministro de material de oficina", (50, 400)),
    ("Diseño y desarrollo de software", (500, 5000)),
    ("Servicio de mudanza y transporte", (200, 1200)),
]

FORMAS_PAGO = [
    "Transferencia bancaria",
    "Domiciliación SEPA",
    "Cheque nominativo",
    "Efectivo",
    "Pagaré a 30 días",
    "Transferencia a 60 días",
]


def format_es(n):
    """Formatea número al estilo español: 1.234,56"""
    s = f"{n:,.2f}"
    # swap , and . for Spanish format
    s = s.replace(',', 'X').replace('.', ',').replace('X', '.')
    return s


def random_date(start_year=2024, end_year=2025):
    """Genera una fecha aleatoria."""
    start = datetime(start_year, 1, 1)
    end = datetime(end_year, 12, 31)
    delta = (end - start).days
    d = start + timedelta(days=random.randint(0, delta))
    return d.strftime("%d/%m/%Y")


def draw_invoice(idx, empresa, receptor, concepto, base, iva_pct, fecha, num_factura, forma_pago):
    """Dibuja una factura como imagen PNG."""
    W, H = 800, 1100
    img = Image.new('RGB', (W, H), 'white')
    draw = ImageDraw.Draw(img)

    # Fuentes — usar la default de Pillow (siempre disponible)
    try:
        font_title = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 22)
        font_header = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 16)
        font_normal = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 14)
        font_small = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 12)
        font_total = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 18)
    except:
        font_title = ImageFont.load_default()
        font_header = font_title
        font_normal = font_title
        font_small = font_title
        font_total = font_title

    y = 40
    # Cabecera empresa
    draw.text((50, y), empresa["nombre"], fill='#1a1a2e', font=font_title)
    y += 30
    draw.text((50, y), f"CIF: {empresa['cif']}", fill='#333', font=font_normal)
    y += 22
    draw.text((50, y), empresa["dir"], fill='#555', font=font_small)
    y += 22
    draw.text((50, y), f"Tel: +34 {random.randint(910, 989)} {random.randint(100, 999)} {random.randint(100, 999)}", fill='#555', font=font_small)

    # Línea separadora
    y += 35
    draw.line([(50, y), (750, y)], fill='#2d3436', width=2)

    # FACTURA título
    y += 20
    draw.text((50, y), "FACTURA", fill='#1a1a2e', font=font_title)
    draw.text((550, y), f"N.º {num_factura}", fill='#1a1a2e', font=font_header)
    y += 30
    draw.text((550, y), f"Fecha: {fecha}", fill='#333', font=font_normal)

    # Datos del cliente
    y += 40
    draw.rectangle([(50, y), (400, y + 80)], outline='#dfe6e9', width=1)
    draw.text((60, y + 5), "DATOS DEL CLIENTE:", fill='#636e72', font=font_small)
    draw.text((60, y + 22), receptor["nombre"], fill='#2d3436', font=font_normal)
    draw.text((60, y + 42), f"CIF: {receptor['cif']}", fill='#333', font=font_normal)

    # Tabla de conceptos
    y += 110
    # Cabecera tabla
    draw.rectangle([(50, y), (750, y + 28)], fill='#2d3436')
    draw.text((60, y + 6), "CONCEPTO", fill='white', font=font_small)
    draw.text((480, y + 6), "CANTIDAD", fill='white', font=font_small)
    draw.text((580, y + 6), "PRECIO", fill='white', font=font_small)
    draw.text((670, y + 6), "IMPORTE", fill='white', font=font_small)

    y += 28
    # 1-3 líneas de concepto
    num_lineas = random.randint(1, 3)
    subtotales = []
    base_restante = base

    for i in range(num_lineas):
        if i < num_lineas - 1:
            linea_importe = round(base_restante * random.uniform(0.2, 0.5), 2)
            base_restante -= linea_importe
        else:
            linea_importe = round(base_restante, 2)

        cantidad = random.choice([1, 2, 3, 5, 10]) if i > 0 else 1
        precio_unit = round(linea_importe / cantidad, 2)
        subtotales.append(linea_importe)

        concepto_texto = concepto if i == 0 else random.choice(["Material auxiliar", "Mano de obra", "Desplazamiento", "Material complementario"])

        draw.rectangle([(50, y), (750, y + 28)], outline='#dfe6e9', width=1)
        # Truncar concepto si es muy largo
        texto_truncado = concepto_texto[:40] + ('...' if len(concepto_texto) > 40 else '')
        draw.text((60, y + 6), texto_truncado, fill='#2d3436', font=font_small)
        draw.text((500, y + 6), str(cantidad), fill='#2d3436', font=font_small)
        draw.text((570, y + 6), f"{format_es(precio_unit)} EUR", fill='#2d3436', font=font_small)
        draw.text((670, y + 6), f"{format_es(linea_importe)} EUR", fill='#2d3436', font=font_small)
        y += 28

    # Resumen fiscal
    iva_importe = round(base * iva_pct / 100, 2)
    irpf_pct = random.choice([0, 0, 0, 15]) if random.random() < 0.3 else 0
    irpf_importe = round(base * irpf_pct / 100, 2)
    total = round(base + iva_importe - irpf_importe, 2)

    y += 30
    draw.line([(450, y), (750, y)], fill='#dfe6e9', width=1)
    y += 10

    draw.text((460, y), "Base Imponible:", fill='#636e72', font=font_normal)
    draw.text((650, y), f"{format_es(base)} EUR", fill='#2d3436', font=font_normal)
    y += 25

    draw.text((460, y), f"IVA ({iva_pct}%):", fill='#636e72', font=font_normal)
    draw.text((650, y), f"{format_es(iva_importe)} EUR", fill='#2d3436', font=font_normal)
    y += 25

    if irpf_pct > 0:
        draw.text((460, y), f"IRPF (-{irpf_pct}%):", fill='#636e72', font=font_normal)
        draw.text((650, y), f"-{format_es(irpf_importe)} EUR", fill='#c0392b', font=font_normal)
        y += 25

    draw.line([(450, y), (750, y)], fill='#2d3436', width=2)
    y += 10

    draw.text((460, y), "TOTAL:", fill='#1a1a2e', font=font_total)
    draw.text((630, y), f"{format_es(total)} EUR", fill='#1a1a2e', font=font_total)

    # Forma de pago
    y += 50
    draw.text((50, y), f"Forma de pago: {forma_pago}", fill='#636e72', font=font_normal)
    y += 25
    if random.random() > 0.5:
        draw.text((50, y), f"IBAN: ES{random.randint(10,99)} {random.randint(1000,9999)} {random.randint(1000,9999)} {random.randint(10,99)} {random.randint(1000000000, 9999999999)}", fill='#636e72', font=font_small)
        y += 20

    # Pie de página
    y = H - 60
    draw.line([(50, y), (750, y)], fill='#dfe6e9', width=1)
    y += 10
    draw.text((50, y), f"Factura generada el {fecha}  |  {empresa['nombre']}", fill='#b2bec3', font=font_small)

    return img, {
        "idx": idx,
        "empresa": empresa["nombre"],
        "cif": empresa["cif"],
        "fecha": fecha,
        "num_factura": num_factura,
        "base": format_es(base),
        "iva_pct": iva_pct,
        "iva_importe": format_es(iva_importe),
        "irpf_pct": irpf_pct,
        "total": format_es(total),
    }


def generate_invoices(count=30):
    """Genera N facturas únicas como PNG."""
    invoices_data = []

    for i in range(count):
        empresa = EMPRESAS[i % len(EMPRESAS)]
        receptor = random.choice(RECEPTORES)
        concepto_text, (min_base, max_base) = random.choice(CONCEPTOS)
        base = round(random.uniform(min_base, max_base), 2)
        iva_pct = random.choice([21, 21, 21, 10, 4])
        fecha = random_date(2024, 2025)
        num_factura = f"{2024 + (i // 20)}-{str(random.randint(1, 9999)).zfill(4)}"
        forma_pago = random.choice(FORMAS_PAGO)

        img, data = draw_invoice(i, empresa, receptor, concepto_text, base, iva_pct, fecha, num_factura, forma_pago)

        filename = f"factura_test_{str(i+1).zfill(3)}.jpg"
        filepath = os.path.join(OUTPUT_DIR, filename)
        img.save(filepath, 'JPEG', quality=92)
        data["filename"] = filename
        invoices_data.append(data)

        print(f"  [{i+1}/{count}] {filename} — {empresa['nombre'][:30]}... CIF:{empresa['cif']} Total:{data['total']} EUR")

    return invoices_data


if __name__ == '__main__':
    count = int(sys.argv[1]) if len(sys.argv) > 1 else 30
    print(f"\n  Generando {count} facturas de test...\n")
    data = generate_invoices(count)
    print(f"\n  {len(data)} facturas generadas en {OUTPUT_DIR}/")
    print(f"  Listas para stress test.\n")
