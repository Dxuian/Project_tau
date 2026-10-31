/* cmo_* : the C API exported from each WASM variant (and linked into the
 * native reference harness). One algorithm per instance; single-threaded.
 *
 * Two roles share this API:
 *  - the work instance (main thread): stratum job -> work, submit JSON;
 *  - scan instances (one per worker): run gate->scanhash over a nonce range.
 */
#include <string.h>
#include <strings.h>
#include <stdlib.h>
#include "miner.h"
#include "algo-gate-api.h"
#include "cmo.h"

/* from ported.c */
void cmo_stratum_gen_work( struct stratum_ctx *sctx, struct work *g_work );
bool cmo_stratum_notify( struct stratum_ctx *sctx, json_t *params );
bool cmo_stratum_set_extranonce( struct stratum_ctx *sctx, const char *xnonce1,
                                 int xn2_size );
const char *cmo_log_take( size_t *len );

#define CMO_EXPORT __attribute__ ((used, visibility ("default")))

CMO_EXPORT int cmo_abi_version( void ) { return CMO_ABI_VERSION; }

/* ------------------------------------------------------------- algorithms */

CMO_EXPORT int cmo_algo_count( void ) { return ALGO_COUNT; }

CMO_EXPORT const char *cmo_algo_name( int algo )
{
   return ( algo > ALGO_NULL && algo < ALGO_COUNT ) ? algo_names[ algo ] : NULL;
}

/* Resolves a name or alias (cpu-miner.c parse_arg 'a'), including the
 * "scrypt:N" form. Returns the algo id, or -1; *param_n gets N (or 0). */
CMO_EXPORT int cmo_algo_resolve( const char *name, int *param_n )
{
   char *arg = (char*)name;
   *param_n = 0;
   get_algo_alias( &arg );
   for ( int i = 1; i < ALGO_COUNT; i++ )
   {
      int v = (int) strlen( algo_names[i] );
      if ( !v || strncasecmp( arg, algo_names[i], v ) ) continue;
      if ( arg[v] == '\0' ) return i;
      if ( arg[v] == ':' )
      {
         char *ep;
         long n = strtol( arg + v + 1, &ep, 10 );
         if ( *ep || n < 2 ) continue;
         *param_n = (int)n;
         return i;
      }
   }
   return -1;
}

/* Registers the gate. thread_init allocates the per-thread scratchpads
 * (scan instances only). Returns 0, -1 (registration failed) or -2 (thread
 * init failed). */
CMO_EXPORT int cmo_init( int algo, int param_n, int param_r, const char *key,
                         int thread_init )
{
   if ( algo <= ALGO_NULL || algo >= ALGO_COUNT ) return -1;
   opt_algo          = (enum algos) algo;   /* minotaurx reads it at hash time */
   opt_param_n       = param_n;
   opt_param_r       = param_r;
   free( opt_param_key );
   opt_param_key     = key ? strdup( key ) : NULL;
   opt_target_factor = 1.0;
   opt_diff_factor   = 1.0;
   work_restart[0].restart = 0;
   if ( !register_algo_gate( algo, &algo_gate ) ) return -1;
   if ( thread_init && !algo_gate.miner_thread_init( 0 ) ) return -2;
   return 0;
}

CMO_EXPORT void cmo_gate_info( int32_t *out )
{
   out[0] = algo_gate.ntime_index;
   out[1] = algo_gate.nbits_index;
   out[2] = algo_gate.nonce_index;
   out[3] = algo_gate.work_cmp_size;
   out[4] = algo_gate.get_work_data_size();
}

CMO_EXPORT double cmo_target_factor( void ) { return opt_target_factor; }

/* ---------------------------------------------------------------- logging */

/* Returns the pending applog text (NUL-terminated) and clears it. */
CMO_EXPORT const char *cmo_log_drain( int32_t *len )
{
   size_t n;
   const char *s = cmo_log_take( &n );
   *len = (int32_t)n;
   return s;
}

/* ---------------------------------------------------- work instance: jobs */

char *cmo_json_escape_dup( const char *s );

/* Pool user name, stored JSON-escaped: every build_stratum_request (upstream's
 * and the algorithms' own) prints it into the submit JSON with %s. */
CMO_EXPORT void cmo_set_user( const char *user )
{
   free( rpc_user );
   rpc_user = cmo_json_escape_dup( user ? user : "" );
}

/* mining.subscribe result: extranonce1 hex and extranonce2 size. */
CMO_EXPORT int cmo_stratum_subscribed( const char *xnonce1, int xn2_size )
{
   stratum.next_diff = 1.0;
   return cmo_stratum_set_extranonce( &stratum, xnonce1, xn2_size ) ? 0 : -1;
}

/* mining.set_extranonce: takes effect with the next notify, as upstream. */
CMO_EXPORT int cmo_set_extranonce( const char *xnonce1, int xn2_size )
{
   return cmo_stratum_set_extranonce( &stratum, xnonce1, xn2_size ) ? 0 : -1;
}

/* mining.set_difficulty: applies to the next notify, as upstream. */
CMO_EXPORT void cmo_set_difficulty( double diff )
{
   if ( diff != 0 ) stratum.next_diff = diff;
}

/* mining.notify params array as JSON text. Returns 0 or -1. */
CMO_EXPORT int cmo_notify( const char *params_json )
{
   json_error_t err;
   json_t *params = json_loads( params_json, 0, &err );
   if ( !params ) return -1;
   bool ok = json_is_array( params ) && cmo_stratum_notify( &stratum, params );
   json_decref( params );
   return ok ? 0 : -1;
}

#define CMO_RING 16
static struct work cmo_ring[ CMO_RING ] __attribute__ ((aligned (64)));
static uint32_t    cmo_ring_seq[ CMO_RING ];
static uint32_t    cmo_next_seq = 1;

static struct work *ring_get( uint32_t seq )
{
   struct work *w = &cmo_ring[ seq % CMO_RING ];
   return ( seq && cmo_ring_seq[ seq % CMO_RING ] == seq ) ? w : NULL;
}

/* Builds work from the current job (cpu-miner.c stratum_gen_work), then
 * advances extranonce2. Returns the work's sequence number, 0 if no job. */
CMO_EXPORT uint32_t cmo_gen_work( void )
{
   if ( !stratum.job.job_id || !stratum.xnonce2_size ) return 0;
   uint32_t seq = cmo_next_seq++;
   if ( !seq ) seq = cmo_next_seq++;
   struct work *w = &cmo_ring[ seq % CMO_RING ];
   work_free( w );
   memset( w, 0, sizeof *w );
   cmo_stratum_gen_work( &stratum, w );
   cmo_ring_seq[ seq % CMO_RING ] = seq;
   return seq;
}

CMO_EXPORT uint32_t *cmo_work_data( uint32_t seq )
{
   struct work *w = ring_get( seq );
   return w ? w->data : NULL;
}

CMO_EXPORT uint32_t *cmo_work_target( uint32_t seq )
{
   struct work *w = ring_get( seq );
   return w ? w->target : NULL;
}

CMO_EXPORT double cmo_work_targetdiff( uint32_t seq )
{
   struct work *w = ring_get( seq );
   return w ? w->targetdiff : 0.;
}

CMO_EXPORT const char *cmo_work_job_id( uint32_t seq )
{
   struct work *w = ring_get( seq );
   return w ? w->job_id : NULL;
}

CMO_EXPORT int cmo_work_height( uint32_t seq )
{
   struct work *w = ring_get( seq );
   return w ? w->height : 0;
}

CMO_EXPORT double cmo_net_diff( void ) { return net_diff; }

/* Builds the mining.submit JSON for a solution of work `seq`. `data` is the
 * full data array captured with the solution (48 words). Returns the length
 * or -1 if the work is no longer in the ring. */
CMO_EXPORT int cmo_build_submit( uint32_t seq, const uint32_t *data, char *out )
{
   struct work *w = ring_get( seq );
   if ( !w ) return -1;
   struct work tmp __attribute__ ((aligned (64)));
   memcpy( &tmp, w, sizeof tmp );
   memcpy( tmp.data, data, sizeof tmp.data );
   out[0] = 0;
   algo_gate.build_stratum_request( out, &tmp, &stratum );
   return (int)strlen( out );
}

/* -------------------------------------------------- scan instance: hashing */

static struct work     cmo_scan_work __attribute__ ((aligned (64)));
static struct thr_info cmo_thr;
static cmo_solution_t  cmo_solutions[ CMO_MAX_SOLUTIONS ];
static int             cmo_nsolutions = 0;

/* Called by every scanhash for hashes that meet the target (it has already
 * run valid_hash). Records the full work data, as the stratum request needs it. */
bool submit_solution( struct work *work, const void *hash, struct thr_info *thr )
{
   (void)thr;
   if ( cmo_nsolutions < CMO_MAX_SOLUTIONS )
   {
      cmo_solution_t *s = &cmo_solutions[ cmo_nsolutions ];
      memcpy( s->data, work->data, sizeof s->data );
      memcpy( s->hash, hash, sizeof s->hash );
      s->sharediff = hash_to_diff( hash );
      s->flags = 0;
   }
   cmo_nsolutions++;
   return true;
}

static void record_legacy_solution( const struct work *work )
{
   if ( cmo_nsolutions < CMO_MAX_SOLUTIONS )
   {
      cmo_solution_t *s = &cmo_solutions[ cmo_nsolutions ];
      memcpy( s->data, work->data, sizeof s->data );
      memset( s->hash, 0, sizeof s->hash );
      s->sharediff = 0.;
      s->flags = CMO_SOLUTION_LEGACY;
   }
   cmo_nsolutions++;
}

CMO_EXPORT uint32_t *cmo_scan_data( void )   { return cmo_scan_work.data; }
CMO_EXPORT uint32_t *cmo_scan_target( void ) { return cmo_scan_work.target; }

/* Scans nonces [start, end) of the data/target written via cmo_scan_data()/
 * cmo_scan_target(). Returns hashes done; solutions via cmo_solutions_*. */
CMO_EXPORT double cmo_scan( uint32_t start, uint32_t end )
{
   const int ni = algo_gate.nonce_index;
   double total = 0.;
   cmo_nsolutions = 0;
   cmo_thr.id = 0;
   work_restart[0].restart = 0;
   for ( uint32_t n = start; ; )
   {
      uint64_t hashes_done = 0;   /* zeroed: some algos write 4 bytes of it */
      cmo_scan_work.data[ ni ] = n;
      int found = algo_gate.scanhash( &cmo_scan_work, end, &hashes_done, &cmo_thr );
      total += (double)hashes_done;
      if ( !found ) break;
      /* Legacy scanhash returned on its first hit with the nonce in data;
       * record it and resume after it, as cpu-miner.c's miner_thread does. */
      record_legacy_solution( &cmo_scan_work );
      uint32_t next = cmo_scan_work.data[ ni ] + 1;
      if ( next <= n || next >= end ) break;
      n = next;
   }
   return total;
}

uint64_t cmo_sha256_fast( struct work *work, int kind, int lanes, uint32_t start,
                          uint64_t end );

/* The hand-tuned sha256 kernel (native/kernels/sha256_fast.c) over the same
 * scan data/target: kind 2 = sha256d, 3 = sha256t, 4 = sha256q; lanes 4 or 8;
 * end may be 2^32. Returns hashes done (0 if built without SIMD). */
CMO_EXPORT double cmo_sha256_fast_scan( int kind, int lanes, uint32_t start, double end )
{
   cmo_nsolutions = 0;
   return (double)cmo_sha256_fast( &cmo_scan_work, kind, lanes, start, (uint64_t)end );
}

/* Number of solutions found by the last cmo_scan (may exceed what's stored). */
CMO_EXPORT int cmo_solution_count( void ) { return cmo_nsolutions; }

CMO_EXPORT cmo_solution_t *cmo_solutions_ptr( void ) { return cmo_solutions; }

/* Deterministic 48-word test input (xorshift32), shared by the native golden
 * harness and the JS tests so both hash exactly the same data. */
CMO_EXPORT void cmo_fixture_data( uint32_t *data )
{
   uint32_t x = 0x6a09e667;
   for ( int i = 0; i < 48; i++ )
   {
      x ^= x << 13;
      x ^= x >> 17;
      x ^= x << 5;
      data[i] = x;
   }
}

CMO_EXPORT int cmo_valid_hash( const uint32_t *hash, const uint32_t *target )
{
   return valid_hash( hash, target ) ? 1 : 0;
}

CMO_EXPORT void cmo_diff_to_target( double diff, uint32_t *target )
{
   diff_to_hash( target, diff );
}

/* ---------------------------------------------------------------- verthash */

/* Adopt a dataset already copied into linear memory (call before cmo_init). */
CMO_EXPORT void cmo_verthash_set( uint8_t *data, double size )
{
   cmo_verthash_data = data;
   cmo_verthash_size = (uint64_t)size;
}

int verthash_generate_data_file( const char *output_file_name );

/* Generates the dataset into buf (size bytes, zeroed). Returns 0 on success. */
CMO_EXPORT int cmo_verthash_generate( uint8_t *buf, double size )
{
   cmo_verthash_gen_buf  = buf;
   cmo_verthash_gen_size = (uint64_t)size;
   int rc = verthash_generate_data_file( "verthash.dat" );
   cmo_verthash_gen_buf  = NULL;
   cmo_verthash_gen_size = 0;
   return rc;
}

/* ------------------------------------------------------------------ memory */

CMO_EXPORT void *cmo_malloc( uint32_t size )
{
   void *p = NULL;
   return posix_memalign( &p, 64, size ) ? NULL : p;
}

CMO_EXPORT void cmo_free( void *p ) { free( p ); }
