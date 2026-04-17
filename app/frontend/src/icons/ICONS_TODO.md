# Iconos PWA — Instrucciones de generación

Los navegadores necesitan los iconos en formato PNG. Genera los dos tamaños
a partir del SVG usando ImageMagick o cualquier convertidor SVG→PNG.

## Opción A — ImageMagick (en el servidor o local)

```bash
# Instalar ImageMagick si no está disponible
apt-get install -y imagemagick

# Generar icon-192x192.png
convert -background none -size 192x192 icons/icon.svg icons/icon-192x192.png

# Generar icon-512x512.png
convert -background none -size 512x512 icons/icon.svg icons/icon-512x512.png
```

## Opción B — Node.js con sharp (dentro del contenedor frontend en build)

```bash
npm exec -- svgexport icons/icon.svg icons/icon-192x192.png 192:192
npm exec -- svgexport icons/icon.svg icons/icon-512x512.png 512:512
```

## Opción C — Online

Sube el archivo `icon.svg` a https://cloudconvert.com/svg-to-png y genera
ambos tamaños (192x192 y 512x512).

## Notas

- Los archivos PNG deben quedar en `/opt/setex-captu-facture/app/frontend/src/icons/`
- Después de añadirlos, reconstruye el frontend:
  `cd /opt/setex-captu-facture/app && docker compose build frontend && docker compose up -d frontend`
- El campo `"purpose": "any maskable"` en el manifest es válido para iconos
  con fondo sólido que ya respetan la zona segura maskable (el icono ocupa ~80% del área).
