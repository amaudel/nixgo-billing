#!/usr/bin/env bash
# Regenera supabase/all-migrations.sql (todas las migraciones juntas, en una transacción) para
# pegar en el SQL Editor de un proyecto de PRUEBAS cuando el CLI no puede conectar.
set -euo pipefail
cd "$(dirname "$0")/.."
{
  echo "-- ARCHIVO GENERADO por scripts/build-all-migrations.sh: no lo edites."
  echo "-- Contiene las migraciones de supabase/migrations/ en orden, para pegar en"
  echo "-- Dashboard → SQL Editor de un proyecto Supabase de PRUEBAS NUEVO (vacío)."
  echo "-- Va dentro de una transacción: si algo falla, no se aplica nada."
  echo "-- Para un proyecto que ya tiene migraciones aplicadas, pega SOLO los archivos nuevos de"
  echo "-- supabase/migrations/. Esta vía no registra el historial del CLI (\`supabase db push\`)."
  echo
  echo "begin;"
  for f in supabase/migrations/*.sql; do
    echo; echo "-- ============================================================ $(basename "$f")"
    cat "$f"
  done
  echo
  echo "commit;"
} > supabase/all-migrations.sql
