#ifndef CURLPARSE_CURL_COMPAT_H
#define CURLPARSE_CURL_COMPAT_H

#ifndef _POSIX_C_SOURCE
#define _POSIX_C_SOURCE 200809L
#endif

#ifndef HAVE_STRCASECMP
#define HAVE_STRCASECMP 1
#endif

#ifndef HAVE_STRINGS_H
#define HAVE_STRINGS_H 1
#endif

#ifndef HAVE_SYS_TYPES_H
#define HAVE_SYS_TYPES_H 1
#endif

#ifndef HAVE_UNISTD_H
#define HAVE_UNISTD_H 1
#endif

#ifndef HAVE_FCNTL_H
#define HAVE_FCNTL_H 1
#endif

#ifndef HAVE_STDBOOL_H
#define HAVE_STDBOOL_H 1
#endif

#ifndef HAVE_BOOL_T
#define HAVE_BOOL_T 1
#endif

#ifndef HAVE_STRUCT_TIMEVAL
#define HAVE_STRUCT_TIMEVAL 1
#endif

#ifndef SIZEOF_CURL_OFF_T
#define SIZEOF_CURL_OFF_T 8
#endif

#ifndef SIZEOF_OFF_T
#define SIZEOF_OFF_T 8
#endif

#ifndef SIZEOF_SIZE_T
#ifdef __wasm32__
#define SIZEOF_SIZE_T 4
#else
#define SIZEOF_SIZE_T 8
#endif
#endif

#ifndef SIZEOF_TIME_T
#define SIZEOF_TIME_T 8
#endif

#ifndef SIZEOF_LONG
#ifdef __wasm32__
#define SIZEOF_LONG 4
#else
#define SIZEOF_LONG 8
#endif
#endif

#ifndef HAVE_RECV
#define HAVE_RECV 1
#endif

#ifndef RECV_TYPE_ARG1
#define RECV_TYPE_ARG1 int
#endif

#ifndef RECV_TYPE_ARG2
#define RECV_TYPE_ARG2 void *
#endif

#ifndef RECV_TYPE_ARG3
#define RECV_TYPE_ARG3 size_t
#endif

#ifndef RECV_TYPE_ARG4
#define RECV_TYPE_ARG4 int
#endif

#ifndef RECV_TYPE_RETV
#define RECV_TYPE_RETV ssize_t
#endif

#ifndef HAVE_SEND
#define HAVE_SEND 1
#endif

#ifndef SEND_NONCONST_ARG2
#define SEND_NONCONST_ARG2 1
#endif

#ifndef SEND_TYPE_ARG1
#define SEND_TYPE_ARG1 int
#endif

#ifndef SEND_TYPE_ARG2
#define SEND_TYPE_ARG2 void *
#endif

#ifndef SEND_TYPE_ARG3
#define SEND_TYPE_ARG3 size_t
#endif

#ifndef SEND_TYPE_ARG4
#define SEND_TYPE_ARG4 int
#endif

#ifndef SEND_TYPE_RETV
#define SEND_TYPE_RETV ssize_t
#endif

#endif
