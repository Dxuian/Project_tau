// Portability patch set for cpuminer-opt v26.1, applied by scripts/prepare-src.mjs
// to a copy of native/vendor/cpuminer-opt (the vendored tree stays pristine).
//
// Every edit is either guarded by __EMSCRIPTEN__ or behaviour-neutral on native
// builds, so the golden reference harness compiles the same patched tree.
//
// Edit kinds:
//   { file, find, replace, count }        literal replacement, must match `count` times (default 1)
//   { file, regex, replace, count }       regex replacement (global), must match `count` times
//   { files, transform }                  custom transform over every file under `files` (dir or file)
// `why` is recorded in the patch report.

const X86_OR_WASM = '(defined(__x86_64__) || defined(__EMSCRIPTEN__))';

// Gate fields the shim calls through function pointers. WebAssembly checks the
// exact signature of every indirect call, so for these fields the `(void*)`
// casts are stripped: a mismatched assignment then becomes a compile error
// instead of a runtime trap.
const TYPED_FIELDS = [
  'scanhash',
  'miner_thread_init',
  'set_work_data_endian',
  'build_extraheader',
  'build_block_header',
  'gen_merkle_root',
  'build_stratum_request',
];

export const patches = [
  // ---------------------------------------------------------------- P0: compile
  {
    id: 'P0-1 intrinsics header',
    why: "simd-utils.h only includes intrinsics for x86_64/aarch64/riscv; use Emscripten's SSE/AVX compat headers.",
    file: 'simd-utils.h',
    find: '#if defined(__x86_64__)\n  #include <x86intrin.h>\n#elif defined(__aarch64__) && defined(__ARM_NEON)',
    replace:
      '#if defined(__x86_64__)\n  #include <x86intrin.h>\n#elif defined(__EMSCRIPTEN__) && defined(__SSE2__)\n  #include <immintrin.h>\n#elif defined(__aarch64__) && defined(__ARM_NEON)',
  },
  {
    id: 'P0-2a SSE layer gate',
    why: 'The 128-bit SSE abstraction is gated on __x86_64__; enable it for Emscripten SSE builds.',
    file: 'simd-utils/simd-128.h',
    find: '#if defined(__x86_64__) && defined(__SSE2__)',
    replace: `#if ${X86_OR_WASM} && defined(__SSE2__)`,
  },
  {
    id: 'P0-2b interleave gates',
    why: 'intrlv.h SSE2 4x32 and 2x64 blocks are gated on __x86_64__ (211 of 252 files fail without this).',
    file: 'simd-utils/intrlv.h',
    regex: /defined\(__x86_64__\) && defined\(__SSE2__\)/g,
    replace: `${X86_OR_WASM} && defined(__SSE2__)`,
    count: 2,
  },
  {
    id: 'P0-2c AVX layer gate',
    why: 'The 256-bit AVX abstraction is gated on __x86_64__; enable it for the Emscripten -mavx2 variant.',
    file: 'simd-utils/simd-256.h',
    find: '#if defined(__x86_64__) && defined(__AVX__)',
    replace: `#if ${X86_OR_WASM} && defined(__AVX__)`,
  },
  {
    id: 'P0-3 v128_neg1 inline asm',
    why: 'x86 inline asm ("=x" constraint) is a hard error on wasm32 even when unused.',
    file: 'simd-utils/simd-128.h',
    find:
      'static inline __m128i v128_neg1_fn()\n{\n   __m128i a;\n#if defined(__AVX__)',
    replace:
      'static inline __m128i v128_neg1_fn()\n{\n#if defined(__EMSCRIPTEN__)\n   return _mm_set1_epi32( -1 );\n#else\n   __m128i a;\n#if defined(__AVX__)',
  },
  {
    id: 'P0-3b v128_neg1 inline asm (close)',
    why: 'see P0-3',
    file: 'simd-utils/simd-128.h',
    regex: /(   return a;\n)\}(\n#define v128_neg1\s)/g,
    replace: '$1#endif\n}$2',
    count: 1,
  },
  {
    id: 'P0-3c m256_neg1 inline asm',
    why: 'Same as P0-3 for the 256-bit layer (avx2 variant).',
    file: 'simd-utils/simd-256.h',
    find: 'static inline __m256i mm256_neg1_fn()\n{\n   __m256i v;\n   asm( "vpcmpeqq %0, %0, %0\\n\\t" : "=x"(v) );\n   return v;\n}',
    replace:
      'static inline __m256i mm256_neg1_fn()\n{\n#if defined(__EMSCRIPTEN__)\n   return _mm256_set1_epi32( -1 );\n#else\n   __m256i v;\n   asm( "vpcmpeqq %0, %0, %0\\n\\t" : "=x"(v) );\n   return v;\n#endif\n}',
  },
  {
    id: 'P0-4 SHUFXOR macros',
    why: 'SHUFXOR_1/2/3 (SIMD hash, used by x11 and most of the x-series) only exist for x86_64/aarch64.',
    file: 'algo/simd/simd-hash-2way.c',
    find: '#if defined(__x86_64__)\n\n#define SHUFXOR_1(x)',
    replace: `#if ${X86_OR_WASM}\n\n#define SHUFXOR_1(x)`,
  },
  {
    id: 'P0-5 bswap builtins',
    why: 'The generic bswap_64 fallback is wrong (ORs all partial shifts); it silently corrupts blake512/JH/SHA-512 2x64.',
    file: 'simd-utils/simd-int.h',
    find: '#if defined(__x86_64__)\n\n#define bswap_64    __builtin_bswap64',
    replace: `#if ${X86_OR_WASM}\n\n#define bswap_64    __builtin_bswap64`,
  },
  {
    id: 'P0-6 64-bit lane vector constants',
    why:
      "Emscripten's __m128i/__m256i have 32-bit lanes, so { 64-bit, 64-bit } initializers are truncated. Wrap them in CMO_V128_U64/CMO_V256_U64 (identity on native).",
    files: [
      'simd-utils/simd-constants.c',
      'algo/simd/simd-hash-2way.c',
      'algo/bmw/bmw512-hash-4way.c',
      'algo/bmw/bmw256-hash-4way.c',
      'algo/yespower/yespower-opt.c',
    ],
    transform: wrapVectorConstants,
  },
  {
    id: 'P0-8 shavite 2-way needs AES',
    why: 'The AVX2 shavite 2-way code uses AES-NI unconditionally (x86 AVX2 implies AES); WASM has no AES instructions.',
    file: 'algo/shavite/shavite-hash-2way.c',
    find: '#if defined(__AVX2__)',
    replace: '#if defined(__AVX2__) && ( defined(__AES__) || defined(__VAES__) )',
  },
  {
    id: 'P0-8b shavite 2-way needs AES (header)',
    why: 'see P0-8',
    file: 'algo/shavite/shavite-hash-2way.h',
    find: '#if defined(__AVX2__)',
    replace: '#if defined(__AVX2__) && ( defined(__AES__) || defined(__VAES__) )',
  },
  {
    id: 'P0-8d allium 8-way needs AES',
    why: 'allium 8-way uses the AES-NI groestl256 unless VAES; without AES it uses the 4-way path.',
    file: 'algo/lyra2/allium-4way.c',
    find: '#elif defined(__AVX2__)\n  #define ALLIUM_8WAY 1',
    replace: '#elif defined(__AVX2__) && defined(__AES__)\n  #define ALLIUM_8WAY 1',
  },
  {
    id: 'P0-8c skunk 4-way needs AES',
    why: 'skunk 4-way uses the AES-NI fugue; without AES it uses the portable skunk path.',
    file: 'algo/x13/skunk-gate.h',
    find: '#elif defined(__AVX2__)\n  #define SKUNK_4WAY 1',
    replace: '#elif defined(__AVX2__) && defined(__AES__)\n  #define SKUNK_4WAY 1',
  },
  {
    id: 'P0-7 portable_endian',
    why: 'portable_endian.h hits #error without __linux__/__APPLE__ (x11evo); Emscripten has <endian.h>.',
    file: 'compat/portable_endian.h',
    find: '#if defined(__linux__) || defined(__CYGWIN__)',
    replace: '#if defined(__linux__) || defined(__CYGWIN__) || defined(__EMSCRIPTEN__)',
  },
  {
    id: 'P0-11 sha256 8-way early-exit Maj',
    why:
      'sha256_8x32_transform_le_short reads H after it was overwritten with e60; use H56 (output words 0-5 were wrong).',
    file: 'algo/sha/sha256-hash-4way.c',
    find: 'F = _mm256_add_epi32( F, _mm256_add_epi32( BSG2_0x( G57 ),\n                                                 MAJx( G57, H, A ) ) );',
    replace:
      'F = _mm256_add_epi32( F, _mm256_add_epi32( BSG2_0x( G57 ),\n                                                 MAJx( G57, H56, A ) ) );',
  },

  // ------------------------------------------------- P1: indirect-call signatures
  {
    id: 'P1-1 typed gate defaults',
    why: 'Untyped K&R helpers (return_true(), do_nothing()) trap when called through typed gate pointers.',
    file: 'algo-gate-api.c',
    find:
      '   gate->miner_thread_init       = (void*)&return_true;',
    replace: '   gate->miner_thread_init       = &cmo_gate_thread_init_true;',
  },
  {
    id: 'P1-1b typed gate defaults',
    why: 'see P1-1',
    file: 'algo-gate-api.c',
    find: '   gate->decode_extra_data       = (void*)&do_nothing;',
    replace: '   gate->decode_extra_data       = &cmo_gate_decode_extra_nop;',
  },
  {
    id: 'P1-1c typed gate defaults',
    why: 'see P1-1',
    file: 'algo-gate-api.c',
    find: '   gate->set_work_data_endian    = (void*)&do_nothing;',
    replace: '   gate->set_work_data_endian    = &cmo_gate_work_nop;',
  },
  {
    id: 'P1-2 stratum request builders',
    why: 'std_le/be_build_stratum_request are declared with 2 parameters but called through a 3-parameter gate field.',
    file: 'algo-gate-api.h',
    find:
      'void std_le_build_stratum_request( char *req, struct work *work );\nvoid std_be_build_stratum_request( char *req, struct work *work );',
    replace:
      'void std_le_build_stratum_request( char *req, struct work *work, struct stratum_ctx *sctx );\nvoid std_be_build_stratum_request( char *req, struct work *work, struct stratum_ctx *sctx );',
  },
  {
    id: 'P1-3 argon2d hash signatures',
    why: 'argon2d250/500/1000/16000 hashes are void f(void*, const void*) but scanhash_argon2d calls them as int f(void*, const void*, int).',
    file: 'algo/argon2d/argon2d-gate.c',
    regex: /void (argon2d\d+_hash)\( void \*output, const void \*input \)/g,
    replace: 'int $1( void *output, const void *input, int cmo_thr_id )',
    count: 4,
  },
  {
    id: 'P1-3b argon2d hash return',
    why: 'see P1-3',
    file: 'algo/argon2d/argon2d-gate.c',
    regex: /([ \t]*argon2_ctx\( &context, Argon2_d \);\n)\}/g,
    replace: '$1   return 1;\n}',
    count: 4,
  },
  {
    id: 'P1-3c argon2d hash prototypes',
    why: 'see P1-3',
    file: 'algo/argon2d/argon2d-gate.h',
    regex: /void (argon2d\d+_hash)\( void \*state, const void \*input \);/g,
    replace: 'int $1( void *state, const void *input, int cmo_thr_id );',
    count: 4,
  },
  {
    id: 'P1-4b zr5 scanhash signature',
    why: 'scanhash_zr5 takes unsigned long* (4 bytes on wasm32) for the uint64_t* hashes_done.',
    file: 'algo/nist5/zr5.c',
    find: 'int scanhash_zr5( struct work *work, uint32_t max_nonce,\n                  unsigned long *hashes_done, struct thr_info *mythr )',
    replace:
      'int scanhash_zr5( struct work *work, uint32_t max_nonce,\n                  uint64_t *hashes_done, struct thr_info *mythr )',
  },
  {
    id: 'P1-4 m7m scanhash signature',
    why: 'scanhash_m7m_hash takes uint64_t max_nonce and unsigned long* (i64/4-byte) instead of the gate types.',
    file: 'algo/m7m/m7m.c',
    find: 'int scanhash_m7m_hash( struct work* work, uint64_t max_nonce,\n                       unsigned long *hashes_done, struct thr_info *mythr )',
    replace:
      'int scanhash_m7m_hash( struct work* work, uint32_t max_nonce,\n                       uint64_t *hashes_done, struct thr_info *mythr )',
  },
  {
    id: 'P1-5 thread-init signatures',
    why: 'Thread-init functions declared bool f() trap when the gate calls them as bool f(int); give them the int parameter.',
    files: ['algo'],
    transform: typeThreadInits,
  },
  {
    id: 'P1-6 strip casts on called gate fields',
    why: `Make signature mismatches compile errors for fields the shim calls: ${TYPED_FIELDS.join(', ')}.`,
    files: ['algo', 'algo-gate-api.c'],
    transform: stripGateCasts,
  },

  // ------------------------------------------------- upstream bugs (all builds)
  {
    id: 'B-1 sha256dt 4x32 padding',
    why:
      'scanhash_sha256dt_4x32 zeroes 9/5 padding words where every other sha256dt path (SHA-NI, NEON, 8x32, 16x32, ref) zeroes 10/6, leaving W14 of both blocks uninitialised (stack garbage enters the second hash).',
    file: 'algo/sha/sha256dt.c',
    find: '   v128_memset_zero( vdata+16 + 5, 9 );',
    replace: '   v128_memset_zero( vdata+16 + 5, 10 );',
  },
  {
    id: 'B-1b sha256dt 4x32 padding',
    why: 'see B-1',
    file: 'algo/sha/sha256dt.c',
    find: '   v128_memset_zero( block + 9, 5 );',
    replace: '   v128_memset_zero( block + 9, 6 );',
  },
  {
    id: 'B-3 bswap32_intrlv80_4x32 words 16-19',
    why:
      'v128_bswap32_intrlv80_4x32 fills header words 16..19 from s2 (words 8..11) instead of s4, so every SSE/NEON 4-way user (sha256q, blake-4way, blake2s, blakecoin, myr-gr, lyra2h/rev2/rev3, x16r/x16rv2) hashed the wrong header. sha256q confirmed against node:crypto.',
    file: 'simd-utils/intrlv.h',
    regex: /(casti_v128u32\( d,1[6-9] \) = v128_duplane32\( )s2(, [0-3] \);)/g,
    replace: '$1s4$2',
    count: 4,
  },
  {
    id: 'B-2 hex simd512 length',
    why:
      'hex passes size<<3 (bits) to simd512_ctx, which takes bytes like every other caller: it hashed 8x the input, reading stack garbage, so hex hashes were nondeterministic (confirmed with valgrind).',
    file: 'algo/x16/hex.c',
    find: '            simd512_ctx( &ctx.simd, hash, in, size<<3 );',
    replace: '            simd512_ctx( &ctx.simd, hash, in, size );',
  },

  // ------------------------------------------------------- verthash in memory
  {
    id: 'V-1 verthash data from memory',
    why: 'In WASM the dataset is preloaded by JS into linear memory instead of read with fopen.',
    file: 'algo/verthash/Verthash.c',
    find: 'int verthash_info_init(verthash_info_t* info, const char* file_name)\n{',
    replace:
      'int verthash_info_init(verthash_info_t* info, const char* file_name)\n{\n#if defined(__EMSCRIPTEN__)\n    if ( !cmo_verthash_data ) return CMO_VERTHASH_DEFERRED;\n    info->fileName = NULL;\n    info->data = cmo_verthash_data;\n    info->dataSize = cmo_verthash_size;\n    info->bitmask = ((cmo_verthash_size - VH_HASH_OUT_SIZE)/VH_BYTE_ALIGNMENT) + 1;\n    return 0;\n#endif',
  },
  {
    id: 'V-2 verthash generation into memory',
    why: 'In WASM the dataset generator writes into a caller-provided buffer through fmemopen.',
    file: 'algo/verthash/Verthash.c',
    find:
      '    if ((db = fopen_utf8(targetFile, "r")) != NULL)\n    {\n        fclose(db);\n        exists = 1;\n    }\n\n    db = fopen_utf8(targetFile, "wb+");',
    replace:
      '#if defined(__EMSCRIPTEN__)\n    db = fmemopen( cmo_verthash_gen_buf, cmo_verthash_gen_size, "w+" );\n    if ( !db ) return NULL;\n#else\n    if ((db = fopen_utf8(targetFile, "r")) != NULL)\n    {\n        fclose(db);\n        exists = 1;\n    }\n\n    db = fopen_utf8(targetFile, "wb+");\n#endif',
  },
  {
    id: 'V-3 verthash deferred registration',
    why: "The main-thread work instance registers verthash without the dataset (it never hashes).",
    file: 'algo/verthash/verthash-gate.c',
    find: '   int vhLoadResult = verthash_info_init( &verthashInfo, verthash_data_file );',
    replace:
      '   int vhLoadResult = verthash_info_init( &verthashInfo, verthash_data_file );\n#if defined(__EMSCRIPTEN__)\n   if ( vhLoadResult == CMO_VERTHASH_DEFERRED ) return true;\n#endif',
  },
];

// ------------------------------------------------------------------ transforms

// Wrap brace initializers made of 64-bit hex literals in CMO_V128_U64 / CMO_V256_U64.
// Only groups of exactly 2 or 4 literals where at least one needs more than 32 bits.
function wrapVectorConstants(src) {
  let n = 0;
  const lit = '(0x[0-9a-fA-F]+(?:[uU]?[lL]{1,2}|[lL]{1,2}[uU]|[uU])?)';
  const sep = '\\s*,\\s*';
  const four = new RegExp(`\\{\\s*${lit}${sep}${lit}${sep}${lit}${sep}${lit}\\s*\\}`, 'g');
  const two = new RegExp(`\\{\\s*${lit}${sep}${lit}\\s*\\}`, 'g');
  const wide = (...xs) => xs.some((x) => x.replace(/[uUlL]+$/, '').length > 10);
  src = src.replace(four, (m, a, b, c, d) => (wide(a, b, c, d) ? (n++, `CMO_V256_U64( ${a}, ${b}, ${c}, ${d} )`) : m));
  src = src.replace(two, (m, a, b) => (wide(a, b) ? (n++, `CMO_V128_U64( ${a}, ${b} )`) : m));
  return { src, count: n };
}

// For every function assigned to gate->miner_thread_init, rewrite `bool f()` /
// `bool f( void )` declarations and definitions to `bool f( int cmo_thr_id )`.
// The set of names is collected across the whole algo tree first.
function typeThreadInits(src, ctx) {
  if (!ctx.threadInitNames) {
    ctx.threadInitNames = new Set();
    for (const text of ctx.allSources()) {
      for (const m of text.matchAll(/gate->miner_thread_init\s*=\s*(?:\(\s*void\s*\*\s*\)\s*)?&?\s*(\w+)/g)) {
        ctx.threadInitNames.add(m[1]);
      }
    }
  }
  let n = 0;
  for (const name of ctx.threadInitNames) {
    const re = new RegExp(`\\bbool(\\s+)${name}\\s*\\(\\s*(?:void\\s*)?\\)`, 'g');
    src = src.replace(re, (_m, ws) => (n++, `bool${ws}${name}( int cmo_thr_id )`));
  }
  return { src, count: n };
}

function stripGateCasts(src) {
  let n = 0;
  const re = new RegExp(`(gate->(?:${TYPED_FIELDS.join('|')})\\s*=\\s*)\\(\\s*void\\s*\\*\\s*\\)\\s*`, 'g');
  src = src.replace(re, (_m, lhs) => (n++, lhs));
  return { src, count: n };
}
