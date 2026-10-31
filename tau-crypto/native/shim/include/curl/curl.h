/* Minimal stand-in for libcurl: the shim never does HTTP, but miner.h and
 * algo-gate-api.h mention these types (miner.h:490-493, algo-gate-api.h). */
#ifndef CMO_CURL_STUB_H
#define CMO_CURL_STUB_H

typedef void CURL;
typedef int curl_socket_t;
#define CURL_ERROR_SIZE 256

#endif
