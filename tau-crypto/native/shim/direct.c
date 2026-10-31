/* Direct single-nonce hashing for algorithms whose scanhash pre-filter makes
 * scan-based golden vectors impractical: quark only checks hashes with
 * hash[7] < 256 (2^-24 of nonces), x11evo only hash[7] == 0 unless
 * target[7] <= 0xffff. Used by the golden harness and tests. Only the scalar
 * implementations have entry points; 4/8-way builds return -1. */
#include <string.h>
#include "miner.h"
#include "algo-gate-api.h"
#include "algo/quark/quark-gate.h"
#include "algo/x11/x11evo-gate.h"

#define CMO_EXPORT __attribute__ ((used, visibility ("default")))

/* Hashes `data` (48 words, as for cmo_scan) with `nonce` using the currently
 * registered algorithm. Returns 0, or -1 if it has no direct entry point. */
CMO_EXPORT int cmo_direct_hash( const uint32_t *data, uint32_t nonce, uint32_t *out )
{
   uint32_t endiandata[20] __attribute__ ((aligned (64)));
   uint32_t hash[8] __attribute__ ((aligned (64)));
   swab32_array( endiandata, (uint32_t*)data, 20 );
   be32enc( &endiandata[19], nonce );
   switch ( opt_algo )
   {
#if !defined(QUARK_8WAY) && !defined(QUARK_4WAY)
      case ALGO_QUARK: quark_hash( hash, endiandata ); break;
#endif
#if !defined(X11EVO_8WAY) && !defined(X11EVO_4WAY)
      case ALGO_X11EVO: x11evo_hash( hash, endiandata ); break;
#endif
      default: return -1;
   }
   memcpy( out, hash, 32 );
   return 0;
}
