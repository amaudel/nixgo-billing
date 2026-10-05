#!/usr/bin/env bash
# Aplica migraciones + pruebas RLS en un Postgres plano. Uso: PSQL="psql -h ... -U postgres" ./run.sh
set -euo pipefail
cd "$(dirname "$0")/.."
PSQL="${PSQL:?define PSQL, p. ej. 'psql -h localhost -U postgres'}"
$PSQL -q -c "drop database if exists nixgo_rls_test" -c "create database nixgo_rls_test"
P="$PSQL -q -v ON_ERROR_STOP=1 -d nixgo_rls_test"
$P -f tests/bootstrap.sql
for f in migrations/*.sql; do $P -f "$f"; done
$P -f tests/rls.sql >/dev/null
$P -f tests/invoice_api.sql >/dev/null
