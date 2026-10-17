#!/bin/bash
# Startup script for the kiranaai-db VM (runs on every boot; idempotent).
# Installs Postgres 16 on first boot, listens on the VPC, creates the app role/db
# while the one-time `db-password` metadata key is present.
set -euo pipefail
md() { curl -sf -H 'Metadata-Flavor: Google' "http://metadata.google.internal/computeMetadata/v1/instance/attributes/$1" || true; }

if [ ! -f /swapfile ]; then
  fallocate -l 1G /swapfile && chmod 600 /swapfile && mkswap /swapfile && echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
swapon -a || true

if [ ! -x /usr/lib/postgresql/16/bin/postgres ]; then
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y curl ca-certificates postgresql-common
  /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y
  DEBIAN_FRONTEND=noninteractive apt-get install -y postgresql-16
fi

CONF=/etc/postgresql/16/main
cat > "$CONF/conf.d/kiranaai.conf" <<'EOF'
listen_addresses = '*'
max_connections = 40
shared_buffers = 128MB
EOF
grep -q 'kiranaai-vpc' "$CONF/pg_hba.conf" ||
  echo 'host all all 10.0.0.0/8 scram-sha-256 # kiranaai-vpc' >> "$CONF/pg_hba.conf"
systemctl restart postgresql

PW="$(md db-password)"
DB="$(md db-name)"; DB="${DB:-kiranaai}"
USR="$(md db-user)"; USR="${USR:-kiranaai}"
if [ -n "$PW" ]; then
  sudo -u postgres psql -v ON_ERROR_STOP=1 -v pw="$PW" -v usr="$USR" -v db="$DB" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN', :'usr') WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'usr')\gexec
ALTER ROLE :"usr" PASSWORD :'pw';
SELECT format('CREATE DATABASE %I OWNER %I', :'db', :'usr') WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = :'db')\gexec
SQL
  sudo -u postgres psql -v ON_ERROR_STOP=1 -d "$DB" -c 'CREATE EXTENSION IF NOT EXISTS pg_trgm'
fi

echo "KIRANAAI_DB_READY"
