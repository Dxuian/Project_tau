/* Shared layout between the C API (cmo.c) and the JS runtime (src/wasm/api.ts). */
#ifndef CMO_H
#define CMO_H

#include <stdint.h>

#define CMO_ABI_VERSION   1
#define CMO_MAX_SOLUTIONS 64

/* Defined in globals.c (cpu-miner.c in upstream, which has no header for it). */
extern struct stratum_ctx stratum;

/* Legacy scanhash functions return true with the nonce in work->data instead
 * of calling submit_solution; their hash is not available (zeros). */
#define CMO_SOLUTION_LEGACY 1

/* 240 bytes; JS reads it at the same offsets (src/wasm/api.ts). */
typedef struct
{
   uint32_t data[48];     /*   0 */
   uint32_t hash[8];      /* 192 */
   double   sharediff;    /* 224 */
   uint32_t flags;        /* 232 */
   uint32_t pad;          /* 236 */
} cmo_solution_t;

#endif
