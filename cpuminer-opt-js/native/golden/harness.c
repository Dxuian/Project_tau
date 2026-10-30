/* Native reference harness: hashes the shared fixture input for one algorithm
 * with the same patched sources and shim as the WASM variants, and prints one
 * JSON line. scripts/golden.sh runs it once per algorithm (fresh process, like
 * one WASM instance per algorithm).
 *
 *   harness --list          algorithm names to test
 *   harness NAME [NONCES]   scan nonces [0, NONCES) with the maximum target
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>
#include "miner.h"
#include "algo-gate-api.h"
#include "cmo.h"

int cmo_algo_resolve( const char *name, int *param_n );
int cmo_init( int algo, int param_n, int param_r, const char *key, int thread_init );
uint32_t *cmo_scan_data( void );
uint32_t *cmo_scan_target( void );
double cmo_scan( uint32_t start, uint32_t end );
int cmo_solution_count( void );
cmo_solution_t *cmo_solutions_ptr( void );
void cmo_fixture_data( uint32_t *data );

int cmo_direct_hash( const uint32_t *data, uint32_t nonce, uint32_t *out );

/* Scan target: word 7 = 0x0fffffff, all other words 0xffffffff. Older
 * cpuminer scanhash loops skip hashing entirely unless target[7] <= 0x10000000
 * (the "htmax" tables), so the maximum target can't be used; with this one
 * about 1 in 16 nonces is a solution in most algorithms. */
#define CMO_GOLDEN_TARGET7 0x0fffffffu
#define CMO_GOLDEN_NONCES  256

/* Per-case settings:
 *  - scryptn2 is memory-hard: fewer nonces;
 *  - quark only tests hashes with hash[7] < 256 (2^-24): hashed directly;
 *  - x11evo only tests hash[7] == 0 unless target[7] <= 0xffff (then about
 *    1 in 2^20 nonces): hashed directly where the scalar code is built,
 *    otherwise (4-way builds) scanned over 2^22 nonces with target[7] 0xffff. */
static const struct { const char *name; uint32_t nonces; uint32_t target7; int direct; } overrides[] = {
   { "scrypt:1048576", 48,        CMO_GOLDEN_TARGET7, 0 },
   { "quark",          16,        CMO_GOLDEN_TARGET7, 1 },
   { "x11evo",         1u << 22,  0x0000ffffu,        1 },
   { NULL, 0, 0, 0 } };
#define CMO_DIRECT_NONCES 16

/* Extra parameterised cases beyond the plain algorithm names, written
 * NAME|n=N|r=R|key=KEY (parameter examples from upstream's README). */
static const char *const extra_cases[] = {
   "scrypt:1048576",
   "yespower-b2b|n=2048|r=32|key=Now I am become Death, the destroyer of worlds",
   "yespower|n=2048|r=32|key=Satoshi Nakamoto 31/Oct/2008 Proof-of-work is essentially one-CPU-one-vote",
   NULL };

static double now( void )
{
   struct timespec ts;
   clock_gettime( CLOCK_MONOTONIC, &ts );
   return ts.tv_sec + ts.tv_nsec * 1e-9;
}

int main( int argc, char **argv )
{
   if ( argc < 2 )
   {
      fprintf( stderr, "usage: %s --list | NAME [NONCES]\n", argv[0] );
      return 2;
   }
   if ( !strcmp( argv[1], "--list" ) )
   {
      for ( int i = 1; i < ALGO_COUNT; i++ ) printf( "%s\n", algo_names[i] );
      for ( int i = 0; extra_cases[i]; i++ ) printf( "%s\n", extra_cases[i] );
      return 0;
   }

   const char *name = argv[1];
   uint32_t nonces = CMO_GOLDEN_NONCES, target7 = CMO_GOLDEN_TARGET7;
   int direct = 0;
   for ( int i = 0; overrides[i].name; i++ )
      if ( !strcmp( overrides[i].name, name ) )
      {
         nonces = overrides[i].nonces;
         target7 = overrides[i].target7;
         direct = overrides[i].direct;
      }
   if ( argc > 2 ) nonces = (uint32_t)strtoul( argv[2], NULL, 10 );
   int param_n = 0, param_r = 0;
   const char *key = NULL;

   /* NAME|n=N|r=R|key=KEY */
   char algo[64];
   const char *bar = strchr( name, '|' );
   size_t alen = bar ? (size_t)( bar - name ) : strlen( name );
   if ( alen >= sizeof algo ) alen = sizeof algo - 1;
   memcpy( algo, name, alen );
   algo[alen] = 0;
   int id = cmo_algo_resolve( algo, &param_n );
   for ( const char *p = bar; p; p = strchr( p + 1, '|' ) )
   {
      if      ( !strncmp( p + 1, "n=", 2 ) )   param_n = atoi( p + 3 );
      else if ( !strncmp( p + 1, "r=", 2 ) )   param_r = atoi( p + 3 );
      else if ( !strncmp( p + 1, "key=", 4 ) ) key = p + 5;   /* key is last */
   }
   if ( id < 0 )
   {
      printf( "{\"algo\":\"%s\",\"status\":\"unknown\"}\n", name );
      return 0;
   }

   if ( id == ALGO_VERTHASH )
   {
      /* Upstream creates ./verthash.dat when missing and --verify is set,
       * and verifies its SHA-256 either way. */
      const char *cache = getenv( "CMO_CACHE" );
      if ( chdir( cache ? cache : "/cache" ) ) return 1;
      opt_verify = true;
   }

   int rc = cmo_init( id, param_n, param_r, key, 1 );
   if ( rc != 0 )
   {
      printf( "{\"algo\":\"%s\",\"id\":%d,\"status\":\"init_failed\",\"rc\":%d}\n", name, id, rc );
      return 0;
   }

   uint32_t *data = cmo_scan_data();
   uint32_t *target = cmo_scan_target();
   cmo_fixture_data( data );
   memset( target, 0xff, 32 );
   target[7] = target7;
   const int ni = algo_gate.nonce_index;

   if ( direct )
   {
      uint32_t probe[8];
      direct = cmo_direct_hash( data, 0, probe ) == 0;   /* scalar code built? */
      if ( direct ) nonces = CMO_DIRECT_NONCES;
   }
   printf( "{\"algo\":\"%s\",\"id\":%d,\"status\":\"ok\",\"mode\":\"%s\",\"nonces\":%u,"
           "\"target7\":%u,", name, id, direct ? "direct" : "scan", nonces, target7 );

   if ( direct )
   {
      printf( "\"nonce_index\":%d,\"solutions\":[", ni );
      for ( uint32_t i = 0; i < nonces; i++ )
      {
         uint32_t hash[8];
         if ( cmo_direct_hash( data, i, hash ) ) return 1;
         printf( "%s{\"n\":%u,\"h\":\"", i ? "," : "", i );
         for ( int b = 0; b < 32; b++ ) printf( "%02x", ((uint8_t*)hash)[b] );
         printf( "\"}" );
      }
      printf( "]}\n" );
      return 0;
   }

   double t0 = now();
   double hashes = cmo_scan( 0, nonces );
   double dt = now() - t0;

   int n = cmo_solution_count();
   if ( n > CMO_MAX_SOLUTIONS ) n = CMO_MAX_SOLUTIONS;
   cmo_solution_t *sols = cmo_solutions_ptr();

   printf( "\"hashes\":%.0f,\"seconds\":%.3f,\"nonce_index\":%d,\"solutions\":[",
           hashes, dt, ni );
   for ( int i = 0; i < n; i++ )
   {
      const uint8_t *h = (const uint8_t*)sols[i].hash;
      printf( "%s{\"n\":%u,\"h\":\"", i ? "," : "", sols[i].data[ni] );
      for ( int b = 0; b < 32; b++ ) printf( "%02x", h[b] );
      printf( "\"%s}", ( sols[i].flags & CMO_SOLUTION_LEGACY ) ? ",\"legacy\":true" : "" );
   }
   printf( "]}\n" );
   return 0;
}
