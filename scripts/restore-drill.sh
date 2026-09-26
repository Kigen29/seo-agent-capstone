#!/usr/bin/env bash
#
# Backup restore drill: dump the source database, restore it into an empty one, and prove the
# restore is complete.
#
# A backup nobody has restored is a hope, not a backup. Neon's point-in-time history protects the
# production branch, but it lives with the same vendor and the same account; this proves the data
# can also be carried out as a plain `pg_dump` and brought back on any Postgres, which is what the
# host-swappability in ADR-0007 actually depends on.
#
# "Complete" is checked, not assumed. The source is fingerprinted inside the same repeatable-read
# snapshot the dump is taken from, so concurrent writes cannot make the comparison flaky, and the
# restored copy must match exactly: every table's row count, every column's type and nullability,
# row-level security on every table, every policy, and every grant to the application role.
#
# The repository is public, so the dump never leaves the machine running this and nothing about
# the data is printed: the log shows names and match results, never counts or values.
#
# Usage:
#   SOURCE_URL=... TARGET_URL=... scripts/restore-drill.sh
#   scripts/restore-drill.sh fingerprint <url>          # print a database's fingerprint
#   scripts/restore-drill.sh compare <source> <target>  # compare two saved fingerprints
#
# PG_RUN is the command prefix that runs Postgres client tools. The default runs the official
# image, so the client is always new enough for the server.

set -euo pipefail

PG_RUN=${PG_RUN:-"docker run -i --rm --network host postgres:18"}

# One line per fact, "kind|name|value", identical SQL on both sides. Counts use query_to_xml so a
# single statement can count every table without a function having to exist in the database.
FINGERPRINT_SQL=$(
  cat <<'SQL'
select line from (
  select 'rows|' || table_schema || '.' || table_name || '|' ||
    (xpath('/row/c/text()', query_to_xml(
      format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text
    as line
  from information_schema.tables
  where table_schema in ('public', 'drizzle') and table_type = 'BASE TABLE'
  union all
  select 'column|' || table_schema || '.' || table_name || '.' || column_name || '|' ||
    data_type || ',' || is_nullable || ',' || coalesce(column_default, '')
  from information_schema.columns
  where table_schema in ('public', 'drizzle')
  union all
  select 'rls|' || n.nspname || '.' || c.relname || '|' ||
    c.relrowsecurity::text || ',' || c.relforcerowsecurity::text
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
  union all
  select 'policy|' || schemaname || '.' || tablename || '.' || policyname || '|' ||
    cmd || ',' || array_to_string(roles, ' ') || ',' ||
    md5(coalesce(qual, '') || '/' || coalesce(with_check, ''))
  from pg_policies
  where schemaname = 'public'
  union all
  select 'grant|' || table_schema || '.' || table_name || '|' || privilege_type
  from information_schema.role_table_grants
  where grantee = 'seo_app'
) facts
order by line;
SQL
)

fingerprint() {
  $PG_RUN psql "$1" -XAtq -v ON_ERROR_STOP=1 -c "$FINGERPRINT_SQL"
}

# Compare two fingerprints. Prints kind|name and a verdict, never the values themselves.
compare() {
  local source=$1 target=$2 failed=0
  local kinds
  kinds=$(cut -d'|' -f1 "$source" | sort -u)
  for kind in $kinds; do
    printf '  %-7s %4s in source\n' "$kind" "$(grep -c "^$kind|" "$source")"
  done
  while IFS= read -r key; do
    echo "  MISMATCH ${key}"
    failed=1
  done < <(
    diff <(sort "$source") <(sort "$target") | grep -E '^[<>]' | cut -c3- | cut -d'|' -f1,2 | sort -u
  )
  if [ "$failed" -ne 0 ]; then
    echo "Restore drill FAILED: the restored copy does not match the source snapshot."
    return 1
  fi
  echo "Restore drill passed: every row count, column, policy, RLS flag and grant matches."
}

case "${1:-}" in
  fingerprint)
    fingerprint "$2"
    exit 0
    ;;
  compare)
    compare "$2" "$3"
    exit $?
    ;;
esac

: "${SOURCE_URL:?SOURCE_URL is required}"
: "${TARGET_URL:?TARGET_URL is required}"

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# An exported snapshot needs a session that stays put, which Neon's pooled endpoint cannot give,
# so talk to the direct compute endpoint. A URL that is not pooled is left as it is.
direct_url=$(printf '%s' "$SOURCE_URL" | sed -E 's/-pooler\./\./')

# Hold one read-only transaction open for the whole dump, and fingerprint the source inside it.
coproc SOURCE { $PG_RUN psql "$direct_url" -XAtq -v ON_ERROR_STOP=1; }
ask() {
  printf '%s\n' "$1" "select '__end__';" >&"${SOURCE[1]}"
  local line
  while IFS= read -r line <&"${SOURCE[0]}"; do
    [ "$line" = "__end__" ] && return 0
    printf '%s\n' "$line"
  done
  echo "The source session ended unexpectedly." >&2
  return 1
}

ask "begin isolation level repeatable read read only;"
snapshot=$(ask "select pg_export_snapshot();")
[ -n "$snapshot" ] || { echo "Could not export a snapshot from the source." >&2; exit 1; }

started=$(date +%s)
$PG_RUN pg_dump "$direct_url" --snapshot="$snapshot" --format=custom --no-owner >"$work/drill.dump"
dumped=$(date +%s)

ask "$FINGERPRINT_SQL" >"$work/source.txt"
roles=$(ask "select rolname from pg_roles where rolname !~ '^pg_' and not rolsuper and rolname <> current_user order by 1;")
ask "commit;"
exec {SOURCE[1]}>&-
wait "$SOURCE_PID" || true

# Roles live in the cluster, not the database, so the empty target has none of them. Create each
# as a login-less shell so the dump's grants and policies can name it.
for role in $roles; do
  $PG_RUN psql "$TARGET_URL" -XAtq -v ON_ERROR_STOP=1 -c \
    "do \$\$ begin if not exists (select 1 from pg_roles where rolname = '$role') then create role \"$role\" nologin; end if; end \$\$;"
done

$PG_RUN pg_restore --no-owner --exit-on-error --dbname "$TARGET_URL" <"$work/drill.dump"
restored=$(date +%s)

fingerprint "$TARGET_URL" >"$work/target.txt"

echo "Dump took $((dumped - started))s ($(du -h "$work/drill.dump" | cut -f1)); restore took $((restored - dumped))s."
compare "$work/source.txt" "$work/target.txt"
