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
$P -f tests/webhooks.sql >/dev/null

# El seed de desarrollo debe aplicarse limpio sobre las migraciones (base aparte: usa un RUC propio).
$PSQL -q -c "drop database if exists nixgo_seed_test" -c "create database nixgo_seed_test"
S="$PSQL -q -v ON_ERROR_STOP=1 -d nixgo_seed_test"
$S -f tests/bootstrap.sql
for f in migrations/*.sql; do $S -f "$f"; done
$S -f seed.sql
$S -f seed.sql   # idempotente: una segunda ejecución no falla ni duplica
test "$($S -Atc "select count(*) from public.organizations o join public.organization_users u on u.organization_id = o.id join public.emission_points e on e.organization_id = o.id")" = "1"
test "$($S -Atc "select count(*) from auth.identities")" = "1"
test "$($S -Atc "select count(*) from public.organization_provider_configs")" = "2"

# all-migrations.sql debe estar al día con supabase/migrations/ (si falla: ./scripts/build-all-migrations.sh).
cp all-migrations.sql /tmp/all-migrations.committed.sql
../scripts/build-all-migrations.sh
diff -q all-migrations.sql /tmp/all-migrations.committed.sql >/dev/null || { echo "all-migrations.sql desactualizado"; exit 1; }
