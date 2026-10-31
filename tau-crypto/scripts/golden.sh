#!/usr/bin/env bash
# Builds the native reference harness for this container's architecture from
# the patched tree in $CMO_CACHE/src and records every algorithm's output on
# the shared fixture: test/golden/golden-<flavor>.json.
#   ref-amd64 image: x86      (-march=x86-64-v2: the code paths of wasm sse41/sse42)
#                    x86-avx2 (-march=x86-64-v3, AVX2 without AES: those of wasm avx2)
#   dev image:       arm64    (second opinion)
# Usage: golden.sh [avx2]
set -euo pipefail
cd "$(dirname "$0")/.."

CACHE="${CMO_CACHE:-/cache}"
SRC="$CACHE/src"
case "$(uname -m)-${1:-}" in
  x86_64-)     NAME=x86;      MARCH=(-march=x86-64-v2) ;;
  x86_64-avx2) NAME=x86-avx2; MARCH=(-march=x86-64-v3) ;;
  aarch64-)    NAME=arm64;    MARCH=(-march=armv8-a+crypto+sha2+aes -flax-vector-conversions) ;;
  *) echo "unsupported: $(uname -m) ${1:-}" >&2; exit 1 ;;
esac
if [ ! -f "$SRC/CMO_SOURCES.txt" ]; then
  echo "patched tree missing: run ./dev golden (it prepares the tree first)" >&2
  exit 1
fi

WORK="$CACHE/golden/$NAME"
OBJ="$WORK/obj"
rm -rf "$OBJ" && mkdir -p "$OBJ"
read -r -a DEFINES < "$SRC/CMO_DEFINES.txt"
CFLAGS=(-std=gnu17 -O2 "${MARCH[@]}" -fno-strict-aliasing "${DEFINES[@]}" -w
        -Inative/shim/include -Inative/shim -I"$SRC" -I"$SRC/compat/jansson"
        -include native/shim/include/cmo-prelude.h)

mapfile -t UPSTREAM < "$SRC/CMO_SOURCES.txt"
SOURCES=()
for s in "${UPSTREAM[@]}"; do SOURCES+=("$SRC/$s"); done
SOURCES+=(native/shim/globals.c native/shim/ported.c native/shim/cmo.c native/shim/direct.c
          native/shim/malloc-huge.c native/kernels/sha256_fast.c native/golden/harness.c)

echo "[golden-$NAME] compiling ${#SOURCES[@]} sources with gcc $(gcc -dumpfullversion) ${MARCH[*]}"
compile_one() {
  local src="$1" obj
  obj="$OBJ/$(echo "$src" | tr '/' '_').o"
  if ! gcc "${CFLAGS[@]}" -c "$src" -o "$obj" 2> "$obj.err"; then
    echo "FAILED $src"; head -5 "$obj.err"; return 1
  fi
}
export -f compile_one
export OBJ
export CFLAGS_STR="${CFLAGS[*]}"
# xargs can't pass arrays; rebuild CFLAGS inside each worker.
printf '%s\n' "${SOURCES[@]}" | xargs -P "$(nproc)" -I{} bash -c \
  'read -r -a CFLAGS <<< "$CFLAGS_STR"; compile_one "$1"' _ {}

gcc -o "$WORK/harness" "$OBJ"/*.o -lgmp -lpthread -lm
echo "[golden-$NAME] harness linked"

OUT="test/golden/golden-$NAME.json"
LINES="$WORK/lines.jsonl"
: > "$LINES"
mapfile -t ALGOS < <("$WORK/harness" --list)
for algo in "${ALGOS[@]}"; do
  line=$(timeout 1800 "$WORK/harness" "$algo" 2>>"$WORK/stderr.log" | grep '^{"algo"' || true)
  if [ -z "$line" ]; then
    line="{\"algo\":\"$algo\",\"status\":\"crashed\"}"
  fi
  echo "$line" >> "$LINES"
  status=$(echo "$line" | sed -E 's/.*"status":"([a-z_]+)".*/\1/')
  secs=$(echo "$line" | sed -nE 's/.*"seconds":([0-9.]+).*/\1/p')
  printf '[golden-%s] %-16s %-12s %ss\n' "$NAME" "$algo" "$status" "${secs:--}"
done

mkdir -p test/golden
{ echo '['; paste -sd, "$LINES"; echo ']'; } > "$OUT"
echo "[golden-$NAME] wrote $OUT"
