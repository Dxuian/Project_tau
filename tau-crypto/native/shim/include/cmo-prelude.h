/* Force-included (-include) into every translation unit of the patched
 * cpuminer-opt tree, for both the WASM variants and the native reference
 * harness. Declares what native/patches/patches.mjs refers to. */
#ifndef CMO_PRELUDE_H
#define CMO_PRELUDE_H

#include <stdint.h>
#include <stdbool.h>
#include <stdio.h>

struct work;

/* P1-1: typed defaults for gate fields called through function pointers. */
bool cmo_gate_thread_init_true( int thr_id );
void cmo_gate_decode_extra_nop( struct work *work, uint64_t *extra );
void cmo_gate_work_nop( struct work *work );

/* P0-6: vector constants written as 64-bit lanes. Emscripten's __m128i and
 * __m256i have 32-bit lanes, so the literals are bit-cast from 64-bit-lane
 * vectors there; elsewhere this is the original brace initializer. */
#if defined(__EMSCRIPTEN__)
typedef unsigned long long cmo_u64x2_t __attribute__ ((vector_size (16)));
typedef unsigned long long cmo_u64x4_t __attribute__ ((vector_size (32)));
#define CMO_V128_U64( a, b )        ( (__m128i)(cmo_u64x2_t){ (a), (b) } )
#define CMO_V256_U64( a, b, c, d )  ( (__m256i)(cmo_u64x4_t){ (a), (b), (c), (d) } )
#else
#define CMO_V128_U64( a, b )        { (a), (b) }
#define CMO_V256_U64( a, b, c, d )  { (a), (b), (c), (d) }
#endif

/* V-1..V-3: verthash dataset held in linear memory (WASM). */
extern uint8_t  *cmo_verthash_data;
extern uint64_t  cmo_verthash_size;
extern uint8_t  *cmo_verthash_gen_buf;
extern uint64_t  cmo_verthash_gen_size;
#define CMO_VERTHASH_DEFERRED 3

#endif
