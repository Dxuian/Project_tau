/* Globals the cpuminer-opt sources expect from cpu-miner.c / util.c
 * (declared in miner.h). One algorithm per instance, single-threaded. */
#include "miner.h"
#include "algo-gate-api.h"

algo_gate_t algo_gate;
enum algos  opt_algo = ALGO_NULL;

bool opt_debug       = false;
bool opt_debug_diff  = false;
bool opt_benchmark   = false;
bool opt_protocol    = false;
bool opt_extranonce  = true;
bool opt_quiet       = true;
bool opt_redirect    = true;
int  opt_timeout     = 300;
bool want_longpoll   = false;
bool have_longpoll   = false;
bool have_gbt        = false;
char *lp_id          = NULL;
char *rpc_userpass   = NULL;
bool allow_getwork   = false;
bool want_stratum    = true;
bool have_stratum    = true;    /* stratum header layout (std_build_block_header) */
char *opt_cert       = NULL;
char *opt_proxy      = NULL;
long opt_proxy_type  = 0;
bool use_syslog      = false;
bool use_colors      = false;

pthread_mutex_t applog_lock = PTHREAD_MUTEX_INITIALIZER;
pthread_mutex_t stats_lock  = PTHREAD_MUTEX_INITIALIZER;
pthread_rwlock_t g_work_lock = PTHREAD_RWLOCK_INITIALIZER;

struct thr_info *thr_info = NULL;
int longpoll_thr_id = -1;
int stratum_thr_id  = -1;
int api_thr_id      = -1;

/* zr5 divides by opt_n_threads; each instance is one thread. */
int opt_n_threads = 1;
static struct work_restart cmo_work_restart[1];
struct work_restart *work_restart = cmo_work_restart;

uint32_t opt_work_size = 0;
static double cmo_thr_hashrates[1];
double *thr_hashrates  = cmo_thr_hashrates;
double global_hashrate = 0.;
double stratum_diff    = 0.;
double net_diff        = 0.;
double net_hashrate    = 0.;

int   opt_param_n       = 0;
int   opt_param_r       = 0;
char *opt_param_key     = NULL;
double opt_diff_factor   = 1.0;
double opt_target_factor = 1.0;
bool  opt_randomize     = false;
bool  allow_mininginfo  = false;
time_t g_work_time      = 0;
bool  opt_stratum_stats = false;
int   num_cpus          = 1;
int   num_cpugroups     = 1;
int   opt_priority      = 0;
bool  opt_hash_meter    = false;
uint32_t accepted_share_count = 0;
uint32_t rejected_share_count = 0;
uint32_t solved_block_count   = 0;
bool  opt_sapling       = false;
const int pk_buffer_size_max = 26;
int   pk_buffer_size    = 25;
char *opt_data_file     = NULL;
bool  opt_verify        = false;
bool  opt_bell          = false;
bool  aes_ni_supported  = false;
char *rpc_user          = NULL;
char *short_url         = NULL;
uint32_t zr5_pok        = 0;

const long double exp32  = EXP32;                                  // 2**32
const long double exp48  = EXP32 * EXP16;                          // 2**48
const long double exp64  = EXP32 * EXP32;                          // 2**64
const long double exp96  = EXP32 * EXP32 * EXP32;                  // 2**96
const long double exp128 = EXP32 * EXP32 * EXP32 * EXP32;          // 2**128
const long double exp160 = EXP32 * EXP32 * EXP32 * EXP32 * EXP16;  // 2**160

struct stratum_ctx stratum = { 0 };

uint8_t  *cmo_verthash_data     = NULL;
uint64_t  cmo_verthash_size     = 0;
uint8_t  *cmo_verthash_gen_buf  = NULL;
uint64_t  cmo_verthash_gen_size = 0;

bool cmo_gate_thread_init_true( int thr_id ) { (void)thr_id; return true; }
void cmo_gate_decode_extra_nop( struct work *work, uint64_t *extra ) { (void)work; (void)extra; }
void cmo_gate_work_nop( struct work *work ) { (void)work; }
