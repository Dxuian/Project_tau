/* Functions ported from cpuminer-opt v26.1 cpu-miner.c and util.c: the gate
 * defaults, work construction (stratum_gen_work), stratum job parsing
 * (stratum_notify) and the hash/target helpers. Networking, threads, stats and
 * console output are dropped; the JS runtime owns those.
 *
 * Deliberate differences from upstream are marked "cmo:". */
#include <string.h>
#include <stdarg.h>
#include <stdlib.h>
#include "miner.h"
#include "algo-gate-api.h"
#include "algo/sha/sha256-hash.h"
#include "algo/sha/sha256d.h"
#include "cmo.h"

/* ------------------------------------------------------------------ logging */

/* cmo: applog appends to a buffer that JS drains (cmo_log_drain) instead of
 * printing; native harness builds print to stderr. */
#define CMO_LOG_SIZE 16384
static char   cmo_log_buf[ CMO_LOG_SIZE ];
static size_t cmo_log_len = 0;

static void cmo_log_vappend( int prio, const char *fmt, va_list ap )
{
   char line[ 1024 ];
   int n = snprintf( line, sizeof line, "%d ", prio );
   vsnprintf( line + n, sizeof line - n, fmt, ap );
#if defined(__EMSCRIPTEN__)
   size_t len = strlen( line );
   if ( cmo_log_len + len + 2 > CMO_LOG_SIZE ) cmo_log_len = 0;
   memcpy( cmo_log_buf + cmo_log_len, line, len );
   cmo_log_len += len;
   cmo_log_buf[ cmo_log_len++ ] = '\n';
   cmo_log_buf[ cmo_log_len ] = 0;
#else
   fprintf( stderr, "%s\n", line );
#endif
}

const char *cmo_log_take( size_t *len )
{
   *len = cmo_log_len;
   cmo_log_len = 0;
   return cmo_log_buf;
}

void applog( int prio, const char *fmt, ... )
{
   va_list ap;
   va_start( ap, fmt );
   cmo_log_vappend( prio, fmt, ap );
   va_end( ap );
}

void applog2( int prio, const char *fmt, ... )
{
   va_list ap;
   va_start( ap, fmt );
   cmo_log_vappend( prio, fmt, ap );
   va_end( ap );
}

void applog_nl( const char *fmt, ... )
{
   va_list ap;
   va_start( ap, fmt );
   cmo_log_vappend( LOG_INFO, fmt, ap );
   va_end( ap );
}

void log_sw_err( char* filename, int line_number, char* msg )
{
   applog( LOG_ERR, "SW_ERR: %s:%d, %s", filename, line_number, msg );
}

void applog_hash( void *hash )
{
   char s[ 65 ];
   bin2hex( s, (const unsigned char*)hash, 32 );
   applog( LOG_INFO, "%s", s );
}

void restart_threads( void ) {}   /* cmo: JS restarts workers on new jobs */

/* ------------------------------------------------------------ util.c helpers */

bool is_power_of_2( int n )
{
   while ( n > 1 )
   {
      if ( n % 2 != 0 ) return false;
      n = n / 2;
   }
   return true;
}

void format_number_si( double* n, char* si_units )
{
  if ( *n < 1024*10 )  {  *si_units = 0;   return;  }
  *n /= 1024;
  if ( *n < 1024*10 )  {  *si_units = 'k'; return;  }
  *n /= 1024;
  if ( *n < 1024*10 )  {  *si_units = 'M'; return;  }
  *n /= 1024;
  if ( *n < 1024*10 )  {  *si_units = 'G'; return;  }
  *n /= 1024;
  if ( *n < 1024*10 )  {  *si_units = 'T'; return;  }
  *n /= 1024;
  if ( *n < 1024*10 )  {  *si_units = 'P'; return;  }
  *n /= 1024;
  if ( *n < 1024*10 )  {  *si_units = 'E'; return;  }
  *n /= 1024;
  if ( *n < 1024*10 )  {  *si_units = 'Z'; return;  }
  *n /= 1024;
  *si_units = 'Y';
}

void scale_hash_for_display ( double* hashrate, char* prefix )
{
   if      ( *hashrate < 1e4 )  *prefix = 0;
   else if ( *hashrate < 1e7 )  { *prefix = 'k'; *hashrate /= 1e3; }
   else if ( *hashrate < 1e10 ) { *prefix = 'M'; *hashrate /= 1e6; }
   else if ( *hashrate < 1e13 ) { *prefix = 'G'; *hashrate /= 1e9; }
   else if ( *hashrate < 1e16 ) { *prefix = 'T'; *hashrate /= 1e12; }
   else                         { *prefix = 'P'; *hashrate /= 1e15; }
}

void format_hashrate( double hashrate, char *output )
{
   char prefix = '\0';
   scale_hash_for_display( &hashrate, &prefix );
   sprintf( output, prefix ? "%.2f %cH/s" : "%.2f H/s%c", hashrate, prefix );
}

/* cmo: plain byte loop (upstream uses a 128-bit bswap for len 32). */
void memrev( unsigned char *p, size_t len )
{
   unsigned char c, *q;
   for ( q = p + len - 1; p < q; p++, q-- )
   {
      c = *p;
      *p = *q;
      *q = c;
   }
}

void cbin2hex( char *out, const char *in, size_t len )
{
   if ( out )
      for ( unsigned int i = 0; i < len; i++ )
         sprintf( out + ( i * 2 ), "%02x", (uint8_t)in[i] );
}

void bin2hex( char *s, const unsigned char *p, size_t len )
{
   for ( size_t i = 0; i < len; i++ )
      sprintf( s + ( i * 2 ), "%02x", (unsigned int) p[i] );
}

char *abin2hex( const unsigned char *p, size_t len )
{
   char *s = (char*) malloc( ( len * 2 ) + 1 );
   if ( !s ) return NULL;
   bin2hex( s, p, len );
   return s;
}

char *bebin2hex( const unsigned char *p, size_t len )
{
   char *s = (char*) malloc( ( len * 2 ) + 1 );
   if ( !s )  return NULL;
   for ( size_t i = 0, j = len - 1; i < len; i++, j-- )
      sprintf( s + ( i*2 ), "%02x", (unsigned int) p[ j ] );
   return s;
}

bool hex2bin( unsigned char *p, const char *hexstr, const size_t len )
{
   if ( hexstr == NULL ) return false;

   size_t hexstr_len = strlen( hexstr );
   if ( ( hexstr_len % 2 ) != 0 )
   {
      applog( LOG_ERR, "hex2bin string truncated" );
      return false;
   }
   size_t bin_len = hexstr_len / 2;
   if ( bin_len > len )
   {
      applog( LOG_ERR, "hex2bin buffer too small" );
      return false;
   }

   memset( p, 0, len );
   size_t i = 0;
   while ( i < hexstr_len )
   {
      char c = hexstr[i];
      unsigned char nibble;
      if      ( c >= '0' && c <= '9' )  nibble = ( c - '0' );
      else if ( c >= 'A' && c <= 'F' )  nibble = ( 10 + ( c - 'A' ) );
      else if ( c >= 'a' && c <= 'f' )  nibble = ( 10 + ( c - 'a' ) );
      else
      {
         applog( LOG_ERR, "hex2bin invalid hex" );
         return false;
      }
      p[ ( i / 2 ) ] |= ( nibble << ( ( 1 - ( i % 2 ) ) * 4 ) );
      i++;
   }
   return true;
}

int timeval_subtract( struct timeval *result, struct timeval *x,
                      struct timeval *y )
{
   if ( x->tv_usec < y->tv_usec )
   {
      int nsec = ( y->tv_usec - x->tv_usec ) / 1000000 + 1;
      y->tv_usec -= 1000000 * nsec;
      y->tv_sec += nsec;
   }
   if ( x->tv_usec - y->tv_usec > 1000000 )
   {
      int nsec = ( x->tv_usec - y->tv_usec ) / 1000000;
      y->tv_usec += 1000000 * nsec;
      y->tv_sec -= nsec;
   }
   result->tv_sec = x->tv_sec - y->tv_sec;
   result->tv_usec = x->tv_usec - y->tv_usec;
   return x->tv_sec < y->tv_sec;
}

/* ------------------------------------------------------------ hash / target */

bool fulltest( const uint32_t *hash, const uint32_t *target )
{
   for ( int i = 7; i >= 0; i-- )
   {
      if ( hash[i] > target[i] ) return false;
      if ( hash[i] < target[i] ) return true;
   }
   return true;
}

/* cmo: pool-standard target, 0xFFFF * 2^208 / diff (upstream uses 2^224 / diff,
 * which is 65536/65535 easier than what pools accept). Stored as eight
 * little-endian words, target[7] most significant. */
void diff_to_hash( uint32_t *target, const double diff )
{
   uint128_t *targ = (uint128_t*)target;
   long double m = ( 65535.0L / 65536.0L ) / (long double)diff;
   targ[1] = (uint128_t)( m * exp96 );
   targ[0] = (uint128_t)( ( m * exp96 - (long double)targ[1] ) * exp128 );
}

double hash_to_diff( const void *target )
{
   const uint128_t *targ = (const uint128_t*)target;
   long double m = ( (long double)targ[1] / exp96 );
   return (double)( 1. / m );
}

bool valid_hash( const void *hash, const void *target )
{
   const uint128_t *h = (const uint128_t*)hash;
   const uint128_t *t = (const uint128_t*)target;
   if ( h[1] > t[1] ) return false;
   if ( h[1] < t[1] ) return true;
   if ( h[0] > t[0] ) return false;
   return true;
}

double nbits_to_diff( uint32_t nbits )
{
   long double diff;
   uint32_t shift = nbits & 0xff;
   uint32_t bits = bswap_32( nbits ) & 0x00ffffff;
   int shift_off = (int)shift - 29;

   if ( bits == 0 ) return 0.;
   if ( shift_off >= -13 && shift_off <= 12 )
   {
      if ( shift_off == 0 )
         diff = (long double)0xffff / (long double)bits;
      else if ( shift_off < 0 )
         diff = (long double)( (uint128_t)0xffff << ( (-shift_off) *8 ) )
              / (long double)bits;
      else
         diff =   (long double)0xffff
                / (long double)( (uint128_t)bits << ( shift_off*8 ) );
   }
   else
   {
      int m;
      diff = 0.;
      for ( m = shift; m < 29; m++ )    diff *= 256.0;
      for ( m = 29; m < shift; m++ )    diff /= 256.0;
   }
   return (double)diff;
}

/* --------------------------------------------------- cpu-miner.c gate defaults */

const char* algo_name( enum algos a )
{
   return ( a > ALGO_NULL && a < ALGO_COUNT ) ? algo_names[a] : NULL;
}

uint32_t* get_stratum_job_ntime()
{
   return (uint32_t*)stratum.job.ntime;
}

void work_free( struct work *w )
{
   if ( w->txs )     free( w->txs );
   if ( w->workid )  free( w->workid );
   if ( w->job_id )  free( w->job_id );
   if ( w->xnonce2 ) free( w->xnonce2 );
   w->txs = w->workid = w->job_id = NULL;
   w->xnonce2 = NULL;
}

void work_copy( struct work *dest, const struct work *src )
{
   memcpy( dest, src, sizeof(struct work) );
   if ( src->txs )     dest->txs = strdup( src->txs );
   if ( src->workid )  dest->workid = strdup( src->workid );
   if ( src->job_id )  dest->job_id = strdup( src->job_id );
   if ( src->xnonce2 )
   {
      dest->xnonce2 = (uchar*) malloc( src->xnonce2_len );
      memcpy( dest->xnonce2, src->xnonce2, src->xnonce2_len );
   }
}

int std_get_work_data_size() { return STD_WORK_DATA_SIZE; }

bool std_le_work_decode( struct work *work )
{
   const int adata_sz = algo_gate.get_work_data_size() / 4;
   for ( int i = 0; i < adata_sz; i++ )
      work->data[i] = le32dec( work->data + i );
   for ( int i = 0; i < 8; i++ )
      work->target[i] = le32dec( work->target + i );
   return true;
}

bool std_be_work_decode( struct work *work )
{
   const int adata_sz = algo_gate.get_work_data_size() / 4;
   for ( int i = 0; i < adata_sz; i++ )
      work->data[i] = be32dec( work->data + i );
   for ( int i = 0; i < 8; i++ )
      work->target[i] = le32dec( work->target + i );
   return true;
}

/* cmo: the submit request is built with printf("%s") (upstream doesn't
 * escape), so strings that go into it are stored JSON-escaped. */
char *cmo_json_escape_dup( const char *s )
{
   size_t n = 0;
   for ( const unsigned char *p = (const unsigned char*)s; *p; p++ )
      n += ( *p == '"' || *p == '\\' ) ? 2 : ( *p < 0x20 ) ? 6 : 1;
   char *out = (char*) malloc( n + 1 ), *o = out;
   if ( !out ) return NULL;
   for ( const unsigned char *p = (const unsigned char*)s; *p; p++ )
   {
      if ( *p == '"' || *p == '\\' ) { *o++ = '\\'; *o++ = (char)*p; }
      else if ( *p < 0x20 ) o += sprintf( o, "\\u%04x", *p );
      else *o++ = (char)*p;
   }
   *o = 0;
   return out;
}

static const char *json_submit_req =
   "{\"method\": \"mining.submit\", \"params\": [\"%s\", \"%s\", \"%s\", \"%s\", \"%s\"], \"id\":4}";

/* cmo: 3 parameters to match the gate field (P1-2). */
void std_le_build_stratum_request( char *req, struct work *work,
                                   struct stratum_ctx *sctx )
{
   unsigned char *xnonce2str;
   uint32_t ntime, nonce;
   char ntimestr[9], noncestr[9];
   (void)sctx;
   le32enc( &ntime, work->data[ algo_gate.ntime_index ] );
   le32enc( &nonce, work->data[ algo_gate.nonce_index ] );
   bin2hex( ntimestr, (unsigned char*)(&ntime), sizeof(uint32_t) );
   bin2hex( noncestr, (unsigned char*)(&nonce), sizeof(uint32_t) );
   xnonce2str = (unsigned char*)abin2hex( work->xnonce2, work->xnonce2_len );
   snprintf( req, JSON_BUF_LEN, json_submit_req, rpc_user ? rpc_user : "",
             work->job_id, xnonce2str, ntimestr, noncestr );
   free( xnonce2str );
}

void std_be_build_stratum_request( char *req, struct work *work,
                                   struct stratum_ctx *sctx )
{
   unsigned char *xnonce2str;
   uint32_t ntime, nonce;
   char ntimestr[9], noncestr[9];
   (void)sctx;
   be32enc( &ntime, work->data[ algo_gate.ntime_index ] );
   be32enc( &nonce, work->data[ algo_gate.nonce_index ] );
   bin2hex( ntimestr, (unsigned char*)(&ntime), sizeof(uint32_t) );
   bin2hex( noncestr, (unsigned char*)(&nonce), sizeof(uint32_t) );
   xnonce2str = (unsigned char*)abin2hex( work->xnonce2, work->xnonce2_len );
   snprintf( req, JSON_BUF_LEN, json_submit_req, rpc_user ? rpc_user : "",
             work->job_id, xnonce2str, ntimestr, noncestr );
   free( xnonce2str );
}

/* getwork / GBT is not supported; these only satisfy references. */
bool std_le_submit_getwork_result( CURL *curl, struct work *work )
{ (void)curl; (void)work; return false; }
bool std_be_submit_getwork_result( CURL *curl, struct work *work )
{ (void)curl; (void)work; return false; }
char* std_malloc_txs_request( struct work *work ) { (void)work; return NULL; }
json_t* std_longpoll_rpc_call( CURL *curl, int *err, char *lp_url )
{ (void)curl; (void)lp_url; if ( err ) *err = 1; return NULL; }

void sha256d_gen_merkle_root( char* merkle_root, struct stratum_ctx* sctx )
{
  sha256d( merkle_root, sctx->job.coinbase, (int) sctx->job.coinbase_size );
  for ( int i = 0; i < sctx->job.merkle_count; i++ )
  {
     memcpy( merkle_root + 32, sctx->job.merkle[i], 32 );
     sha256d( merkle_root, merkle_root, 64 );
  }
}

void sha256_gen_merkle_root( char* merkle_root, struct stratum_ctx* sctx )
{
  sha256_full( merkle_root, sctx->job.coinbase, (int)sctx->job.coinbase_size );
  for ( int i = 0; i < sctx->job.merkle_count; i++ )
  {
     memcpy( merkle_root + 32, sctx->job.merkle[i], 32 );
     sha256d( merkle_root, merkle_root, 64 );
  }
}

void set_work_data_big_endian( struct work *work )
{
   int nonce_index = algo_gate.nonce_index;
   for ( int i = 0; i < nonce_index; i++ )
        be32enc( work->data + i, work->data[i] );
}

void std_get_new_work( struct work* work, struct work* g_work, int thr_id,
                       uint32_t *end_nonce_ptr )
{
   uint32_t *nonceptr = work->data + algo_gate.nonce_index;
   bool force_new_work = false;

   if ( have_stratum )
      force_new_work = work->job_id ?    strtoul(   work->job_id, NULL, 16 )
                                      != strtoul( g_work->job_id, NULL, 16 )
                                     : false;

   if ( force_new_work || ( *nonceptr >= *end_nonce_ptr )
     || memcmp( work->data, g_work->data, algo_gate.work_cmp_size ) )
   {
     work_free( work );
     work_copy( work, g_work );
     *nonceptr = 0xffffffffU / opt_n_threads * thr_id;
     *end_nonce_ptr = ( 0xffffffffU / opt_n_threads ) * (thr_id+1) - 0x20;
   }
   else
       ++(*nonceptr);
}

void std_build_block_header( struct work* g_work, uint32_t version,
       uint32_t *prevhash, uint32_t *merkle_tree, uint32_t ntime,
       uint32_t nbits, unsigned char *final_sapling_hash )
{
   int i;

   memset( g_work->data, 0, sizeof(g_work->data) );
   g_work->data[0] = version;
   g_work->sapling = opt_sapling;

   if ( have_stratum ) for ( i = 0; i < 8; i++ )
         g_work->data[ 1+i ] = le32dec( prevhash + i );
   else for (i = 0; i < 8; i++)
         g_work->data[ 8-i ] = le32dec( prevhash + i );
   for ( i = 0; i < 8; i++ )
      g_work->data[ 9+i ] = be32dec( merkle_tree + i );
   g_work->data[ algo_gate.ntime_index ] = ntime;
   g_work->data[ algo_gate.nbits_index ] = nbits;

   if ( g_work->sapling )
   {
      if ( have_stratum )
         for ( i = 0; i < 8; i++ )
            g_work->data[20 + i] = le32dec( (uint32_t*)final_sapling_hash + i );
      else
      {
         for ( i = 0; i < 8; i++ )
            g_work->data[27 - i] = le32dec( (uint32_t*)final_sapling_hash + i );
         g_work->data[19] = 0;
      }
      g_work->data[28] = 0x80000000;
      g_work->data[29] = 0x00000000;
      g_work->data[30] = 0x00000000;
      g_work->data[31] = 0x00000380;
   }
   else
   {
      g_work->data[20] = 0x80000000;
      g_work->data[31] = 0x00000280;
   }
}

void std_build_extraheader( struct work* g_work, struct stratum_ctx* sctx )
{
   uchar merkle_tree[64] = { 0 };

   algo_gate.gen_merkle_root( (char*)merkle_tree, sctx );
   algo_gate.build_block_header( g_work, le32dec( sctx->job.version ),
          (uint32_t*) sctx->job.prevhash, (uint32_t*) merkle_tree,
          le32dec( sctx->job.ntime ), le32dec(sctx->job.nbits),
          sctx->job.final_sapling_hash );
}

/* cpu-miner.c stratum_gen_work without locks, thread restarts or stats. */
void cmo_stratum_gen_work( struct stratum_ctx *sctx, struct work *g_work )
{
   sctx->new_job = false;

   free( g_work->job_id );
   g_work->job_id = strdup( sctx->job.job_id );
   g_work->xnonce2_len = sctx->xnonce2_size;
   g_work->xnonce2 = (uchar*) realloc( g_work->xnonce2, sctx->xnonce2_size );
   g_work->height = sctx->block_height;
   g_work->targetdiff = sctx->job.diff
                           / ( opt_target_factor * opt_diff_factor );
   memcpy( g_work->xnonce2, sctx->job.xnonce2, sctx->xnonce2_size );
   algo_gate.build_extraheader( g_work, sctx );
   net_diff = nbits_to_diff( g_work->data[ algo_gate.nbits_index ] );
   algo_gate.set_work_data_endian( g_work );
   diff_to_hash( g_work->target, g_work->targetdiff );

   // Pre increment extranonce2 for the next call before a new job.
   for ( size_t t = 0;
         t < sctx->xnonce2_size && !( ++sctx->job.xnonce2[t] );
         t++ );
}

/* ------------------------------------------------------------ util.c stratum */

/* cmo: bounded to the coinbase (upstream could read 32 bytes past the end). */
static uint32_t getblocheight( struct stratum_ctx *sctx )
{
   uint32_t height = 0;
   uint8_t hlen = 0, *p, *m;

   if ( sctx->job.coinbase_size < 32 + 8 ) return 0;
   p = (uint8_t*) sctx->job.coinbase + 32;
   m = (uint8_t*) sctx->job.coinbase + sctx->job.coinbase_size - 6;
   while ( *p != 0xff && p < m ) p++;
   while ( *p == 0xff && p < m ) p++;
   if ( *(p-1) == 0xff && *(p-2) == 0xff )
   {
      p++; hlen = *p;
      p++; height = le16dec(p);
      p += 2;
      switch ( hlen )
      {
         case 4:
            height += 0x10000UL * le16dec(p);
            break;
         case 3:
            height += 0x10000UL * (*p);
            break;
      }
   }
   return height;
}

bool cmo_stratum_set_extranonce( struct stratum_ctx *sctx, const char *xnonce1,
                                 int xn2_size )
{
   if ( !xnonce1 || xn2_size < 2 || xn2_size > 16 ) return false;
   if ( sctx->xnonce1 ) free( sctx->xnonce1 );
   sctx->xnonce1_size = strlen( xnonce1 ) / 2;
   sctx->xnonce1 = (uchar*) calloc( 1, sctx->xnonce1_size ? sctx->xnonce1_size : 1 );
   if ( !sctx->xnonce1 ) return false;
   hex2bin( sctx->xnonce1, xnonce1, sctx->xnonce1_size );
   sctx->xnonce2_size = xn2_size;
   return true;
}

bool cmo_stratum_notify( struct stratum_ctx *sctx, json_t *params )
{
   const char *job_id, *prevhash, *coinb1, *coinb2, *version, *nbits, *stime;
   const char *finalsaplinghash = NULL;
   const char *denom10 = NULL, *denom100 = NULL, *denom1000 = NULL,
              *denom10000 = NULL, *prooffullnode = NULL;
   const char *extradata = NULL;
   size_t coinb1_size, coinb2_size;
   bool clean;
   int merkle_count, i, p = 0;
   json_t *merkle_arr;
   uchar **merkle = NULL;
   int jsize = json_array_size( params );
   bool has_claim = ( opt_algo == ALGO_LBRY ) && ( jsize == 10 );
   bool has_roots = ( opt_algo == ALGO_PHI2 ) && ( jsize == 10 );
   bool is_veil  = ( opt_algo == ALGO_X16RT_VEIL );

   job_id = json_string_value( json_array_get( params, p++ ) );
   prevhash = json_string_value( json_array_get( params, p++ ) );
   if ( has_claim )
   {
       extradata = json_string_value( json_array_get( params, p++ ) );
       if ( !extradata || strlen( extradata ) != 64 )
       {
           applog( LOG_ERR, "Stratum notify: invalid claim parameter" );
           return false;
       }
   }
   else if ( has_roots )
   {
       extradata = json_string_value( json_array_get( params, p++ ) );
       if ( !extradata || strlen( extradata ) != 128 )
       {
           applog( LOG_ERR, "Stratum notify: invalid UTXO root parameter" );
           return false;
       }
   }
   if ( is_veil )
   {
      denom10 = json_string_value( json_array_get( params, p++ ) );
      denom100 = json_string_value( json_array_get( params, p++ ) );
      denom1000 = json_string_value( json_array_get( params, p++ ) );
      denom10000 = json_string_value( json_array_get( params, p++ ) );
      prooffullnode = json_string_value( json_array_get( params, p++ ) );
   }

   coinb1 = json_string_value( json_array_get( params, p++ ) );
   coinb2 = json_string_value( json_array_get( params, p++ ) );
   merkle_arr = json_array_get( params, p++ );
   if ( !merkle_arr || !json_is_array( merkle_arr ) )
      return false;
   merkle_count = (int) json_array_size( merkle_arr );
   version = json_string_value( json_array_get( params, p++ ) );
   nbits = json_string_value( json_array_get( params, p++ ) );
   stime = json_string_value( json_array_get( params, p++ ) );
   clean = json_is_true( json_array_get( params, p ) ); p++;

   if ( !job_id || !prevhash || !coinb1 || !coinb2 || !version || !nbits || !stime ||
        strlen(prevhash) != 64 || strlen(version) != 8 ||
        strlen(nbits) != 8 || strlen(stime) != 8 )
   {
      applog( LOG_ERR, "Stratum notify: invalid parameters" );
      return false;
   }

   /* cmo: validate every field before touching the job, so a bad notify
    * leaves the previous job intact (upstream half-updates it). */
   if ( opt_sapling )
   {
      finalsaplinghash = json_string_value( json_array_get( params, 9 ) );
      if ( !finalsaplinghash || strlen(finalsaplinghash) != 64 )
      {
         applog( LOG_ERR, "Stratum notify: invalid sapling parameters" );
         return false;
      }
   }
   if ( is_veil )
   {
      if ( !denom10 || !denom100 || !denom1000 || !denom10000
        || !prooffullnode || strlen(denom10) != 64 || strlen(denom100) != 64
        || strlen(denom1000) != 64 || strlen(denom10000) != 64
        || strlen(prooffullnode) != 64 )
      {
         applog( LOG_ERR, "Stratum notify: invalid veil parameters" );
         return false;
      }
   }
   for ( i = 0; i < merkle_count; i++ )
   {
      const char *s = json_string_value( json_array_get( merkle_arr, i ) );
      if ( !s || strlen(s) != 64 )
      {
         applog( LOG_ERR, "Stratum notify: invalid Merkle branch" );
         return false;
      }
   }
   if ( ( strlen( coinb1 ) % 2 ) || ( strlen( coinb2 ) % 2 ) )
   {
      applog( LOG_ERR, "Stratum notify: invalid coinbase" );
      return false;
   }

   hex2bin( sctx->job.version, version, 4 );

   if ( merkle_count )
   {
      if ( merkle_count > sctx->job.merkle_buf_size )
      {
         for ( i = 0; i < sctx->job.merkle_buf_size; i++ )
            free( sctx->job.merkle[i] );
         free( sctx->job.merkle );

         merkle = (uchar**) malloc( merkle_count * sizeof(char *) );
         for ( i = 0; i < merkle_count; i++ )
            merkle[i] = (uchar*) malloc( 32 );
         sctx->job.merkle_buf_size = merkle_count;
         sctx->job.merkle = merkle;
      }
      for ( i = 0; i < merkle_count; i++ )
         hex2bin( sctx->job.merkle[i],
                  json_string_value( json_array_get( merkle_arr, i ) ), 32 );
   }
   sctx->job.merkle_count = merkle_count;

   coinb1_size = strlen( coinb1 ) / 2;
   coinb2_size = strlen( coinb2 ) / 2;
   sctx->job.coinbase_size = coinb1_size + sctx->xnonce1_size +
                             sctx->xnonce2_size + coinb2_size;
   sctx->job.coinbase = (uchar*) realloc( sctx->job.coinbase,
                                          sctx->job.coinbase_size );
   sctx->job.xnonce2 = sctx->job.coinbase + coinb1_size + sctx->xnonce1_size;
   hex2bin( sctx->job.coinbase, coinb1, coinb1_size );
   memcpy( sctx->job.coinbase + coinb1_size,
           sctx->xnonce1, sctx->xnonce1_size );
   char *escaped_id = cmo_json_escape_dup( job_id );
   if ( !sctx->job.job_id || !escaped_id || strcmp( sctx->job.job_id, escaped_id ) )
      memset( sctx->job.xnonce2, 0, sctx->xnonce2_size );
   free( escaped_id );
   hex2bin( sctx->job.xnonce2 + sctx->xnonce2_size, coinb2, coinb2_size );
   free( sctx->job.job_id );
   sctx->job.job_id = cmo_json_escape_dup( job_id );
   hex2bin( sctx->job.prevhash, prevhash, 32 );
   if ( has_claim ) hex2bin( sctx->job.extra, extradata, 32 );
   if ( has_roots ) hex2bin( sctx->job.extra, extradata, 64 );
   if ( opt_sapling )
      hex2bin( sctx->job.final_sapling_hash, finalsaplinghash, 32 );

   if ( is_veil )
   {
      hex2bin( sctx->job.denom10, denom10, 32 );
      hex2bin( sctx->job.denom100, denom100, 32 );
      hex2bin( sctx->job.denom1000, denom1000, 32 );
      hex2bin( sctx->job.denom10000, denom10000, 32 );
      hex2bin( sctx->job.proofoffullnode, prooffullnode, 32 );
   }

   sctx->block_height = getblocheight( sctx );
   hex2bin( sctx->job.nbits, nbits, 4 );
   hex2bin( sctx->job.ntime, stime, 4 );
   sctx->job.clean = clean;
   sctx->job.diff = sctx->next_diff;
   sctx->new_job = true;
   return true;
}
