/* Hand-tuned sha256d / sha256t / sha256q nonce scanner for WASM SIMD128.
 *
 * Same structure as cpuminer-opt's 4x32 code (algo/sha/sha256-hash-4way.c):
 * midstate of the first 64 header bytes, rounds 0-2 and most of round 3 of the
 * second block precomputed per work (they don't depend on the nonce), the
 * nonce-independent message-schedule terms precomputed, zero padding words
 * folded into constants. Added on top of upstream's 4x32 path:
 *  - an early exit after round 60 of the final compression (hash word 7 is
 *    known then), with the remaining rounds computed plainly (upstream's
 *    8/16-way early-exit code reads overwritten H/A; this doesn't);
 *  - an 8-lane form that interleaves two independent 4-lane streams round by
 *    round for instruction-level parallelism.
 * Lane i of a vector holds nonce n + i (8-lane: second vector n + 4 + i). */
#include <stdint.h>
#include <string.h>
#include "miner.h"
#include "algo-gate-api.h"

#if defined(__wasm_simd128__)
#include <wasm_simd128.h>

static const uint32_t K256[64] = {
   0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
   0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
   0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
   0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
   0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
   0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
   0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
   0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2 };

static const uint32_t IV256[8] = {
   0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19 };

/* ------------------------------------------------------------- scalar side */

#define ROTR32( x, n )  ( ( (x) >> (n) ) | ( (x) << ( 32 - (n) ) ) )
#define S_BSG0( x )     ( ROTR32( x, 2 ) ^ ROTR32( x, 13 ) ^ ROTR32( x, 22 ) )
#define S_BSG1( x )     ( ROTR32( x, 6 ) ^ ROTR32( x, 11 ) ^ ROTR32( x, 25 ) )
#define S_SSG0( x )     ( ROTR32( x, 7 ) ^ ROTR32( x, 18 ) ^ ( (x) >> 3 ) )
#define S_SSG1( x )     ( ROTR32( x, 17 ) ^ ROTR32( x, 19 ) ^ ( (x) >> 10 ) )
#define S_CH( e, f, g ) ( ( (e) & (f) ) ^ ( ~(e) & (g) ) )
#define S_MAJ( a, b, c ) ( ( (a) & (b) ) ^ ( (a) & (c) ) ^ ( (b) & (c) ) )

static void compress_scalar( uint32_t s[8], const uint32_t in[16] )
{
   uint32_t w[64], a = s[0], b = s[1], c = s[2], d = s[3],
            e = s[4], f = s[5], g = s[6], h = s[7];
   memcpy( w, in, 64 );
   for ( int i = 16; i < 64; i++ )
      w[i] = S_SSG1( w[i-2] ) + w[i-7] + S_SSG0( w[i-15] ) + w[i-16];
   for ( int i = 0; i < 64; i++ )
   {
      uint32_t t1 = h + S_BSG1( e ) + S_CH( e, f, g ) + K256[i] + w[i];
      uint32_t t2 = S_BSG0( a ) + S_MAJ( a, b, c );
      h = g; g = f; f = e; e = d + t1; d = c; c = b; b = a; a = t1 + t2;
   }
   s[0] += a; s[1] += b; s[2] += c; s[3] += d;
   s[4] += e; s[5] += f; s[6] += g; s[7] += h;
}

/* Per-work constants: midstate, state after rounds 0-2 of block 1, round 3
 * without its W3 term, and the nonce-independent schedule terms X0..X6. */
typedef struct
{
   uint32_t mid[8];
   uint32_t pa, pe;           /* a4 = pa + nonce, e4 = pe + nonce */
   uint32_t b4, c4, d4, f4, g4, h4;
   uint32_t x0, x1, x2, x3, x4, x5, x6;
} prehash_t;

static void prehash( prehash_t *p, const uint32_t *data )
{
   memcpy( p->mid, IV256, 32 );
   compress_scalar( p->mid, data );

   const uint32_t w0 = data[16], w1 = data[17], w2 = data[18];
   uint32_t a = p->mid[0], b = p->mid[1], c = p->mid[2], d = p->mid[3],
            e = p->mid[4], f = p->mid[5], g = p->mid[6], h = p->mid[7];
   const uint32_t w[3] = { w0, w1, w2 };
   for ( int i = 0; i < 3; i++ )
   {
      uint32_t t1 = h + S_BSG1( e ) + S_CH( e, f, g ) + K256[i] + w[i];
      uint32_t t2 = S_BSG0( a ) + S_MAJ( a, b, c );
      h = g; g = f; f = e; e = d + t1; d = c; c = b; b = a; a = t1 + t2;
   }
   /* round 3 without W3 */
   uint32_t t1 = h + S_BSG1( e ) + S_CH( e, f, g ) + K256[3];
   uint32_t t2 = S_BSG0( a ) + S_MAJ( a, b, c );
   p->pa = t1 + t2;
   p->pe = d + t1;
   p->b4 = a; p->c4 = b; p->d4 = c;
   p->f4 = e; p->g4 = f; p->h4 = g;

   p->x0 = S_SSG0( w1 ) + w0;                            /* W16 */
   p->x1 = S_SSG1( 640u ) + S_SSG0( w2 ) + w1;            /* W17 */
   p->x2 = S_SSG1( p->x0 ) + w2;                          /* W18 - s0(nonce) */
   p->x3 = S_SSG1( p->x1 ) + S_SSG0( 0x80000000u );       /* W19 - nonce */
   p->x4 = S_SSG0( 640u );                                /* part of W30 */
   p->x5 = S_SSG0( p->x0 ) + 640u;                        /* part of W31 */
   p->x6 = S_SSG0( p->x1 ) + p->x0;                       /* part of W32 */
}

/* -------------------------------------------------------------- vector side */

#define V( x )          wasm_i32x4_splat( (int32_t)(x) )
#define ADD( a, b )     wasm_i32x4_add( a, b )
#define XOR( a, b )     wasm_v128_xor( a, b )
#define ROTR( x, n )    wasm_v128_or( wasm_u32x4_shr( x, n ), wasm_i32x4_shl( x, 32 - (n) ) )
#define BSG0( x )       XOR( XOR( ROTR( x, 2 ), ROTR( x, 13 ) ), ROTR( x, 22 ) )
#define BSG1( x )       XOR( XOR( ROTR( x, 6 ), ROTR( x, 11 ) ), ROTR( x, 25 ) )
#define SSG0( x )       XOR( XOR( ROTR( x, 7 ), ROTR( x, 18 ) ), wasm_u32x4_shr( x, 3 ) )
#define SSG1( x )       XOR( XOR( ROTR( x, 17 ), ROTR( x, 19 ) ), wasm_u32x4_shr( x, 10 ) )
#define CH( e, f, g )   wasm_v128_bitselect( f, g, e )
#define MAJ( a, b, c )  wasm_v128_bitselect( b, c, XOR( a, c ) )
#define BSWAP32( x )    wasm_i8x16_shuffle( x, x, 3,2,1,0, 7,6,5,4, 11,10,9,8, 15,14,13,12 )

/* S independent 4-lane streams (S = 1 or 2), processed round by round. */
#define UNROLL _Pragma( "clang loop unroll(full)" )
#define FOR_S  UNROLL for ( int s = 0; s < S; s++ )

/* One SHA-256 round on stream s; state held in rotating arrays st[0..7][s]
 * indexed by the round number so no moves are needed. */
#define ROUND( r, kw ) FOR_S { \
   v128_t *A = &st[ ( 64 - (r) + 0 ) & 7 ][s], *B = &st[ ( 64 - (r) + 1 ) & 7 ][s], \
          *C = &st[ ( 64 - (r) + 2 ) & 7 ][s], *D = &st[ ( 64 - (r) + 3 ) & 7 ][s], \
          *E = &st[ ( 64 - (r) + 4 ) & 7 ][s], *F = &st[ ( 64 - (r) + 5 ) & 7 ][s], \
          *G = &st[ ( 64 - (r) + 6 ) & 7 ][s], *H = &st[ ( 64 - (r) + 7 ) & 7 ][s]; \
   v128_t t1 = ADD( ADD( ADD( *H, BSG1( *E ) ), CH( *E, *F, *G ) ), kw ); \
   v128_t t2 = ADD( BSG0( *A ), MAJ( *A, *B, *C ) ); \
   *D = ADD( *D, t1 ); \
   *H = ADD( t1, t2 ); }

/* After round r the register for "a" is st[(64 - r - 1) & 7], i.e. the
 * state word i lives at st[(64 - rounds + i) & 7] after `rounds` rounds. */
#define WORD( i, rounds ) st[ ( 64 - (rounds) + (i) ) & 7 ]

/* Full 64-round compression of a 32-byte digest (padded) with IV start
 * state; out = IV + rounds. W0..7 = in, W8 = 0x80000000, W15 = 256. */
#define COMPRESS_DIGEST( out, in ) do { \
   v128_t st[8][S], w[16][S]; \
   for ( int i = 0; i < 8; i++ ) FOR_S st[i][s] = V( IV256[i] ); \
   for ( int i = 0; i < 8; i++ ) FOR_S w[i][s] = in[i][s]; \
   UNROLL for ( int r = 0; r < 8; r++ ) ROUND( r, ADD( V( K256[r] ), w[r][s] ) ); \
   ROUND( 8, V( K256[8] + 0x80000000u ) ); \
   UNROLL for ( int r = 9; r < 15; r++ ) ROUND( r, V( K256[r] ) ); \
   ROUND( 15, V( K256[15] + 256u ) ); \
   for ( int i = 8; i < 15; i++ ) FOR_S w[i][s] = V( 0 ); \
   FOR_S w[8][s] = V( 0x80000000u ); \
   FOR_S w[15][s] = V( 256u ); \
   UNROLL for ( int r = 16; r < 64; r++ ) { \
      FOR_S w[r & 15][s] = ADD( ADD( SSG1( w[(r-2) & 15][s] ), w[(r-7) & 15][s] ), \
                                ADD( SSG0( w[(r-15) & 15][s] ), w[r & 15][s] ) ); \
      ROUND( r, ADD( V( K256[r] ), w[r & 15][s] ) ); } \
   for ( int i = 0; i < 8; i++ ) FOR_S out[i][s] = ADD( WORD( i, 64 )[s], V( IV256[i] ) ); \
} while ( 0 )

static inline void solution( struct work *w, uint32_t nonce, const uint32_t hash[8] )
{
   if ( !valid_hash( hash, w->target ) ) return;
   const uint32_t saved = w->data[19];
   w->data[19] = nonce;
   submit_solution( w, hash, NULL );
   w->data[19] = saved;
}

/* Scans [start, end) for kind = 2 (sha256d), 3 (sha256t) or 4 (sha256q). */
#define DEFINE_SCAN( NAME, S ) \
static uint64_t NAME( struct work *work, int kind, uint64_t start, uint64_t end ) \
{ \
   prehash_t p; \
   prehash( &p, work->data ); \
   const uint32_t t7 = work->target[7]; \
   const v128_t targ7 = V( t7 ); \
   const v128_t lane = wasm_i32x4_make( 0, 1, 2, 3 ); \
   uint64_t done = 0; \
   for ( uint64_t n0 = start; n0 + 4 * S <= end; n0 += 4 * S ) \
   { \
      v128_t nonce[S], st[8][S], w[16][S], dg[8][S]; \
      FOR_S nonce[s] = ADD( V( (uint32_t)n0 + 4 * s ), lane ); \
      /* block 1, from the round-3 precompute */ \
      FOR_S { \
         st[ ( 64 - 4 + 0 ) & 7 ][s] = ADD( V( p.pa ), nonce[s] ); \
         st[ ( 64 - 4 + 1 ) & 7 ][s] = V( p.b4 ); \
         st[ ( 64 - 4 + 2 ) & 7 ][s] = V( p.c4 ); \
         st[ ( 64 - 4 + 3 ) & 7 ][s] = V( p.d4 ); \
         st[ ( 64 - 4 + 4 ) & 7 ][s] = ADD( V( p.pe ), nonce[s] ); \
         st[ ( 64 - 4 + 5 ) & 7 ][s] = V( p.f4 ); \
         st[ ( 64 - 4 + 6 ) & 7 ][s] = V( p.g4 ); \
         st[ ( 64 - 4 + 7 ) & 7 ][s] = V( p.h4 ); } \
      ROUND( 4, V( K256[4] + 0x80000000u ) ); \
      UNROLL for ( int r = 5; r < 15; r++ ) ROUND( r, V( K256[r] ) ); \
      ROUND( 15, V( K256[15] + 640u ) ); \
      FOR_S { \
         w[0][s] = V( p.x0 );                                   /* W16 */ \
         w[1][s] = V( p.x1 );                                   /* W17 */ \
         w[2][s] = ADD( V( p.x2 ), SSG0( nonce[s] ) );          /* W18 */ \
         w[3][s] = ADD( V( p.x3 ), nonce[s] );                  /* W19 */ \
         w[4][s] = ADD( SSG1( w[2][s] ), V( 0x80000000u ) );    /* W20 */ \
         w[5][s] = SSG1( w[3][s] );                             /* W21 */ \
         w[6][s] = ADD( SSG1( w[4][s] ), V( 640u ) );           /* W22 */ \
         w[7][s] = ADD( SSG1( w[5][s] ), V( p.x0 ) );           /* W23 */ \
         w[8][s] = ADD( SSG1( w[6][s] ), V( p.x1 ) );           /* W24 */ \
         w[9][s] = ADD( SSG1( w[7][s] ), w[2][s] );             /* W25 */ \
         w[10][s] = ADD( SSG1( w[8][s] ), w[3][s] );            /* W26 */ \
         w[11][s] = ADD( SSG1( w[9][s] ), w[4][s] );            /* W27 */ \
         w[12][s] = ADD( SSG1( w[10][s] ), w[5][s] );           /* W28 */ \
         w[13][s] = ADD( SSG1( w[11][s] ), w[6][s] );           /* W29 */ \
         w[14][s] = ADD( ADD( SSG1( w[12][s] ), w[7][s] ), V( p.x4 ) );  /* W30 */ \
         w[15][s] = ADD( ADD( SSG1( w[13][s] ), w[8][s] ), V( p.x5 ) );  /* W31 */ } \
      UNROLL for ( int r = 16; r < 32; r++ ) ROUND( r, ADD( V( K256[r] ), w[r - 16][s] ) ); \
      /* W32 = s1(W30) + W25 + X6, then the general schedule */ \
      FOR_S w[0][s] = ADD( ADD( SSG1( w[14][s] ), w[9][s] ), V( p.x6 ) ); \
      ROUND( 32, ADD( V( K256[32] ), w[0][s] ) ); \
      UNROLL for ( int r = 33; r < 64; r++ ) { \
         FOR_S w[r & 15][s] = ADD( ADD( SSG1( w[(r-2) & 15][s] ), w[(r-7) & 15][s] ), \
                                   ADD( SSG0( w[(r-15) & 15][s] ), w[r & 15][s] ) ); \
         ROUND( r, ADD( V( K256[r] ), w[r & 15][s] ) ); } \
      for ( int i = 0; i < 8; i++ ) FOR_S dg[i][s] = ADD( WORD( i, 64 )[s], V( p.mid[i] ) ); \
      /* middle passes for sha256t / sha256q */ \
      for ( int pass = 2; pass < kind; pass++ ) COMPRESS_DIGEST( dg, dg ); \
      /* final pass with the early exit after round 60 */ \
      { \
         for ( int i = 0; i < 8; i++ ) FOR_S st[i][s] = V( IV256[i] ); \
         for ( int i = 0; i < 8; i++ ) FOR_S w[i][s] = dg[i][s]; \
         UNROLL for ( int r = 0; r < 8; r++ ) ROUND( r, ADD( V( K256[r] ), w[r][s] ) ); \
         ROUND( 8, V( K256[8] + 0x80000000u ) ); \
         UNROLL for ( int r = 9; r < 15; r++ ) ROUND( r, V( K256[r] ) ); \
         ROUND( 15, V( K256[15] + 256u ) ); \
         for ( int i = 8; i < 15; i++ ) FOR_S w[i][s] = V( 0 ); \
         FOR_S w[8][s] = V( 0x80000000u ); \
         FOR_S w[15][s] = V( 256u ); \
         UNROLL for ( int r = 16; r < 61; r++ ) { \
            FOR_S w[r & 15][s] = ADD( ADD( SSG1( w[(r-2) & 15][s] ), w[(r-7) & 15][s] ), \
                                      ADD( SSG0( w[(r-15) & 15][s] ), w[r & 15][s] ) ); \
            ROUND( r, ADD( V( K256[r] ), w[r & 15][s] ) ); } \
         /* after 61 rounds, e = final h before the IV add */ \
         bool any = false; \
         FOR_S any |= wasm_v128_any_true( \
            wasm_u32x4_le( BSWAP32( ADD( WORD( 4, 61 )[s], V( IV256[7] ) ) ), targ7 ) ); \
         if ( any ) \
         { \
            UNROLL for ( int r = 61; r < 64; r++ ) { \
               FOR_S w[r & 15][s] = ADD( ADD( SSG1( w[(r-2) & 15][s] ), w[(r-7) & 15][s] ), \
                                         ADD( SSG0( w[(r-15) & 15][s] ), w[r & 15][s] ) ); \
               ROUND( r, ADD( V( K256[r] ), w[r & 15][s] ) ); } \
            FOR_S { \
               uint32_t hv[8][4] __attribute__ ((aligned (16))); \
               for ( int i = 0; i < 8; i++ ) \
                  wasm_v128_store( hv[i], BSWAP32( ADD( WORD( i, 64 )[s], V( IV256[i] ) ) ) ); \
               for ( int l = 0; l < 4; l++ ) \
               { \
                  if ( hv[7][l] > t7 ) continue; \
                  uint32_t hash[8]; \
                  for ( int i = 0; i < 8; i++ ) hash[i] = hv[i][l]; \
                  solution( work, (uint32_t)n0 + 4 * s + l, hash ); \
               } } \
         } \
      } \
      done += 4 * S; \
   } \
   return done; \
}

#define S 1
DEFINE_SCAN( scan_x4, 1 )
#undef S
#define S 2
DEFINE_SCAN( scan_x8, 2 )
#undef S

/* Remaining nonces (fewer than a vector) with the scalar path. */
static uint64_t scan_tail( struct work *work, int kind, uint64_t n, uint64_t end )
{
   uint32_t blk[16], st[8], dg[8];
   uint64_t done = 0;
   for ( ; n < end; n++, done++ )
   {
      memcpy( st, IV256, 32 );
      compress_scalar( st, work->data );
      memcpy( blk, work->data + 16, 12 );
      blk[3] = (uint32_t)n;
      blk[4] = 0x80000000u;
      memset( blk + 5, 0, 40 );
      blk[15] = 640u;
      compress_scalar( st, blk );
      for ( int pass = 1; pass < kind; pass++ )
      {
         memcpy( dg, st, 32 );
         memcpy( blk, dg, 32 );
         blk[8] = 0x80000000u;
         memset( blk + 9, 0, 24 );
         blk[15] = 256u;
         memcpy( st, IV256, 32 );
         compress_scalar( st, blk );
      }
      uint32_t hash[8];
      for ( int i = 0; i < 8; i++ ) hash[i] = __builtin_bswap32( st[i] );
      solution( work, (uint32_t)n, hash );
   }
   return done;
}

/* kind: 2 = sha256d, 3 = sha256t, 4 = sha256q; lanes: 4 or 8. Scans nonces
 * [start, end) (end may be 2^32) of work->data / work->target. */
uint64_t cmo_sha256_fast( struct work *work, int kind, int lanes, uint32_t start, uint64_t end )
{
   if ( kind < 2 || kind > 4 ) return 0;
   uint64_t n = start, done = 0;
   const uint64_t step = lanes == 8 ? 8 : 4;
   const uint64_t vec_end = n + ( ( end - n ) / step ) * step;
   if ( vec_end > n )
   {
      done += lanes == 8 ? scan_x8( work, kind, n, vec_end )
                         : scan_x4( work, kind, n, vec_end );
      n = vec_end;
   }
   done += scan_tail( work, kind, n, end );
   return done;
}

#else

uint64_t cmo_sha256_fast( struct work *work, int kind, int lanes, uint32_t start, uint64_t end )
{
   (void)work; (void)kind; (void)lanes; (void)start; (void)end;
   return 0;
}

#endif
