/* Shadows the compiler's mm_malloc.h (included by miner.h:69). Under
 * Emscripten its xmmintrin.h defines _mm_malloc/_mm_free as macros, which
 * break clang's mm_malloc.h; elsewhere this is equivalent to it. */
#ifndef CMO_MM_MALLOC_H
#define CMO_MM_MALLOC_H

#include <stdlib.h>

#ifndef _mm_malloc
static inline void *_mm_malloc( size_t size, size_t align )
{
   void *p;
   if ( align < sizeof(void*) ) align = sizeof(void*);
   return posix_memalign( &p, align, size ) ? NULL : p;
}
#endif

#ifndef _mm_free
static inline void _mm_free( void *p ) { free( p ); }
#endif

#endif
