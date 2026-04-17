#!/bin/bash
set -euo pipefail

echo "=== Configurando UFW para setex-captu-facture ==="

# Default policies
sudo ufw default deny incoming
sudo ufw default allow outgoing

# SSH (crítico - permitir antes de enable)
sudo ufw allow 22/tcp comment 'SSH'

# HTTP/HTTPS (Traefik)
sudo ufw allow 80/tcp comment 'HTTP'
sudo ufw allow 443/tcp comment 'HTTPS'

# Denegar acceso directo a puertos de aplicación
sudo ufw deny 5678/tcp comment 'Deny direct n8n'
sudo ufw deny 5432/tcp comment 'Deny direct PostgreSQL'

# Rate limiting en SSH
sudo ufw limit 22/tcp

# Logging
sudo ufw logging on

# Enable
sudo ufw --force enable

echo "✓ UFW configurado correctamente"
sudo ufw status verbose
