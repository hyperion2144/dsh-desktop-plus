/**
 * Shell-side HTTP that honours the same proxy answer the Host subprocess receives.
 *
 * Node's `fetch` follows the process proxy environment, which is the user's shell
 * environment — not the desktop proxy setting, and not the system bypass list. A LAN
 * address that the browser reaches directly would therefore be sent to a corporate
 * proxy and time out. Every shell request goes through {@link createConfiguredFetch}
 * instead: it resolves one proxy answer, decides the bypass with Chromium's
 * `ProxyOverride` glob semantics, and connects directly when the target is bypassed.
 *
 * @module @deepseek-ai/dsh-desktop-plus-shell/net/configured-fetch
 */

import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { connect as tlsConnect, type TLSSocket } from 'node:tls'
import type { ClientRequest, IncomingMessage } from 'node:http'
import type { Socket } from 'node:net'
import type { ProxyEnv } from './proxy-env.ts'


/** What the configured fetch needs from its owner. */
export interface ConfiguredFetchOptions {
  /** Resolve the proxy answer now; null means direct. Called per request so a settings change applies immediately. */
  readonly proxy: () => ProxyEnv | null
  /** Give up after this many milliseconds; defaults to {@link DEFAULT_TIMEOUT_MS}. */
  readonly timeoutMs?: number
  /** Stop buffering a response body past this many bytes; defaults to {@link DEFAULT_MAX_BODY_BYTES}. */
  readonly maxBodyBytes?: number
}

/** A request that has not finished by now is treated as unreachable. */
const DEFAULT_TIMEOUT_MS = 30_000

/** A response larger than this is truncated; the shell only reads status and short bodies. */
const DEFAULT_MAX_BODY_BYTES = 8 * 1024 * 1024

/** The subset of `fetch` this module provides. */
export type ConfiguredFetch = (input: string | URL, init?: RequestInit) => Promise<Response>

/**
 * Whether a host bypasses the proxy under Chromium's `ProxyOverride` semantics.
 *
 * Chromium accepts a bare host (exact and subdomains), a `*.domain` wildcard, a
 * `prefix*` glob such as `10.*`, the `<local>` token for dotless names, and an
 * optional `:port` on any entry. Node's own matcher understands only the first two,
 * which is why a Windows bypass list never took effect.
 * @param hostname - request host, without brackets or a trailing dot.
 * @param port - effective request port.
 * @param noProxy - the bypass list, comma or whitespace separated.
 * @returns true when the request must connect directly.
 */
export function bypassesProxy(hostname: string, port: string, noProxy: string): boolean {
  const host = hostname.replace(/^\[|\]$/gu, '').replace(/\.$/u, '').toLowerCase()
  for (const raw of noProxy.split(/[,\s]+/u)) {
    const entry = raw.trim().toLowerCase()
    if (entry === '') continue
    if (entry === '*') return true
    // `<local>` is Chromium's token for names without a dot, plus loopback.
    if (entry === '<local>') {
      if (!host.includes('.') || host === 'localhost' || host === '127.0.0.1' || host === '::1') return true
      continue
    }
    const colon = entry.lastIndexOf(':')
    const hasPort = colon > 0 && /^\d+$/u.test(entry.slice(colon + 1))
    const entryHost = hasPort ? entry.slice(0, colon) : entry
    const entryPort = hasPort ? entry.slice(colon + 1) : undefined
    if (entryPort !== undefined && entryPort !== port) continue
    if (entryHost === '') continue
    if (entryHost.includes('*')) {
      // A glob matches the whole host: `10.*` is a prefix, `*.example.com` a suffix.
      const pattern = entryHost.replace(/[.+?^${}()|[\]\\]/gu, '\\$&').replace(/\*/gu, '.*')
      if (new RegExp(`^${pattern}$`, 'u').test(host)) return true
      continue
    }
    if (host === entryHost || host.endsWith(`.${entryHost}`)) return true
  }
  return false
}

/** One HTTP answer, reduced to what the callers read. */
interface Answer {
  readonly status: number
  readonly headers: Headers
  readonly body: Buffer
}

/**
 * The proxy a request must use, from the resolved answer alone.
 * A scheme's own proxy wins, then `all`, then for HTTPS only the HTTP proxy,
 * matching how the Host subprocess reads the same record.
 * @param answer - resolved proxy answer.
 * @param url - request URL.
 * @returns the proxy URL, or undefined when the request goes direct.
 */
function proxyFor(answer: ProxyEnv, url: URL): URL | undefined {
  const chosen = url.protocol === 'https:'
    ? answer.https ?? answer.all ?? answer.http
    : answer.http ?? answer.all
  if (chosen === null || chosen === undefined || chosen === '') return undefined
  try {
    return new URL(chosen)
  } catch {
    return undefined
  }
}

/** Proxy credentials as a `Proxy-Authorization` value, when the proxy URL carries them. */
function proxyAuthorization(proxy: URL): Record<string, string> {
  if (proxy.username === '' && proxy.password === '') return {}
  const credentials = `${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`
  return { 'proxy-authorization': `Basic ${Buffer.from(credentials).toString('base64')}` }
}

/** Read one response into an {@link Answer}. */
async function readAnswer(response: IncomingMessage, maxBytes: number): Promise<Answer> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of response) {
    const buffer = chunk as Buffer
    if (total + buffer.byteLength >= maxBytes) {
      chunks.push(buffer.subarray(0, maxBytes - total))
      total = maxBytes
      // Stop pulling bytes the caller will never see.
      response.destroy()
      break
    }
    chunks.push(buffer)
    total += buffer.byteLength
  }
  const headers = new Headers()
  for (const [name, value] of Object.entries(response.headers)) {
    if (value === undefined) continue
    if (Array.isArray(value)) for (const entry of value) headers.append(name, entry)
    else headers.set(name, value)
  }
  return { status: response.statusCode ?? 0, headers, body: Buffer.concat(chunks) }
}

/**
 * Open a TLS connection to the target through an HTTP `CONNECT` tunnel.
 * @param proxy - proxy URL.
 * @param target - request URL.
 * @param signal - caller cancellation.
 * @returns the established TLS socket.
 */
async function tunnel(proxy: URL, target: URL, signal: AbortSignal | undefined): Promise<TLSSocket> {
  const authority = `${target.hostname}:${target.port === '' ? '443' : target.port}`
  const socket = await new Promise<Socket>((resolve, reject) => {
    const request = httpRequest({
      host: proxy.hostname,
      port: proxy.port === '' ? 80 : Number(proxy.port),
      method: 'CONNECT',
      path: authority,
      headers: { host: authority, ...proxyAuthorization(proxy) },
      agent: false,
      signal: signal ?? undefined,
    })
    request.once('connect', (response, connected) => {
      if (response.statusCode !== 200) {
        connected.destroy()
        reject(new Error(`proxy CONNECT refused with ${String(response.statusCode)}`))
        return
      }
      resolve(connected)
    })
    request.once('error', reject)
    request.end()
  })
  return await new Promise((resolve, reject) => {
    const secure = tlsConnect({ socket, servername: target.hostname })
    secure.once('secureConnect', () => { resolve(secure) })
    secure.once('error', reject)
  })
}

/**
 * Send one request, directly or through the resolved proxy.
 * Nothing here reads a proxy environment variable: the route comes from the resolved
 * answer, so `off`, `manual`, and `system` each behave exactly as configured.
 * @param url - absolute request URL.
 * @param init - request options as `fetch` accepts them.
 * @param route - where the request goes.
 * @returns the answer with its body already read.
 */
async function sendRequest(url: URL, init: RequestInit, proxy: URL | undefined, maxBytes: number): Promise<Answer> {
  if (init.body !== undefined && init.body !== null && typeof init.body !== 'string') {
    // Sending no body would look like a successful empty request; refuse instead.
    throw new Error('configured fetch: only a string body is supported')
  }
  const body = typeof init.body === 'string' ? Buffer.from(init.body) : undefined
  const headers: Record<string, string> = {}
  new Headers(init.headers).forEach((value, name) => { headers[name] = value })
  if (body !== undefined && headers['content-length'] === undefined) headers['content-length'] = String(body.byteLength)
  const secure = url.protocol === 'https:'
  if (proxy === undefined) {
    const send = secure ? httpsRequest : httpRequest
    return await exchange(send(url, { method: init.method ?? 'GET', headers, agent: false, signal: init.signal ?? undefined }), body, maxBytes)
  }
  if (!secure) {
    // A plain-HTTP proxy request carries the absolute URI and the proxy's own credentials.
    return await exchange(httpRequest({
      host: proxy.hostname,
      port: proxy.port === '' ? 80 : Number(proxy.port),
      method: init.method ?? 'GET',
      path: url.href,
      headers: { host: url.host, ...headers, ...proxyAuthorization(proxy) },
      agent: false,
      signal: init.signal ?? undefined,
    }), body, maxBytes)
  }
  const socket = await tunnel(proxy, url, init.signal ?? undefined)
  return await exchange(httpsRequest(url, {
    method: init.method ?? 'GET',
    headers,
    signal: init.signal ?? undefined,
    createConnection: () => socket,
  }), body, maxBytes)
}


/**
 * Write the body, wait for the answer, and read it.
 * @param request - the request already configured by the caller.
 * @param body - request body, or undefined for none.
 * @param maxBytes - response body cap.
 * @returns the answer with its body already read.
 */
async function exchange(request: ClientRequest, body: Buffer | undefined, maxBytes: number): Promise<Answer> {
  return await new Promise<Answer>((resolve, reject) => {
    request.on('response', (response) => { readAnswer(response, maxBytes).then(resolve, reject) })
    request.on('error', reject)
    if (body !== undefined) request.write(body)
    request.end()
  })
}
/** Status codes a `fetch` call follows when the caller did not say otherwise. */
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

/** A chain longer than this is a loop, not a destination. */
const MAX_REDIRECTS = 20

/**
 * Build the shell's one HTTP entry point.
 * The route comes from the resolved proxy answer: a bypassed target connects directly,
 * everything else goes through the configured proxy. No proxy environment variable is
 * consulted, so the shell and the Host subprocess cannot disagree.
 * @param options - proxy resolution for the current settings.
 * @returns a `fetch`-compatible function.
 */
export function createConfiguredFetch(options: ConfiguredFetchOptions): ConfiguredFetch {
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES
    return async (input, init = {}) => {
      // One deadline covers the whole call, redirects included, so a slow proxy cannot
      // stretch a single request into an unbounded wait.
      const deadline = AbortSignal.timeout(timeoutMs)
      const signal = init.signal === undefined || init.signal === null
        ? deadline
        : AbortSignal.any([init.signal, deadline])
      let url = input instanceof URL ? input : new URL(input)
      let method = init.method ?? 'GET'
      let body = init.body
      for (let hop = 0; ; hop += 1) {
        const answer = options.proxy()
        const port = url.port !== '' ? url.port : url.protocol === 'https:' ? '443' : '80'
        const bypassed = answer === null || bypassesProxy(url.hostname, port, answer.no_proxy)
        const proxy = answer === null || bypassed ? undefined : proxyFor(answer, url)
        const request: RequestInit = { ...init, method, signal }
        if (body !== undefined) request.body = body
        const result = await sendRequest(url, request, proxy, maxBodyBytes).catch((error: unknown) => {
          // A deadline abort reads as a timeout, not as a caller cancellation.
          if (deadline.aborted && !(init.signal?.aborted ?? false)) {
            throw new Error(`request timed out after ${String(timeoutMs)}ms: ${url.href}`)
          }
          throw error
        })
        const location = result.headers.get('location')
        if (init.redirect === 'manual' || init.redirect === 'error' || location === null
          || !REDIRECT_STATUSES.has(result.status)) {
          return new Response(new Uint8Array(result.body), { status: result.status, headers: result.headers })
        }
        if (hop >= MAX_REDIRECTS) throw new TypeError(`configured fetch: too many redirects for ${url.href}`)
        url = new URL(location, url)
        // 303, and 301/302 on a POST, drop the body and become a GET.
        if (result.status === 303 || ((result.status === 301 || result.status === 302) && method === 'POST')) {
          method = 'GET'
          body = undefined
        }
      }
    }
  }
