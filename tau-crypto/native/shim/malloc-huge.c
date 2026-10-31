/* Replaces malloc-huge.c: no huge pages in WASM, and the native reference
 * harness has no need for them. Callers fall back to their regular
 * allocation when this returns NULL. */
#include "malloc-huge.h"

void *malloc_hugepages( size_t size )
{
   (void)size;
   return NULL;
}
