// Copyright 2017-2019 LinkedIn Corp. Licensed under the BSD 2-Clause License (the "License"). See License in the project root for license information.

/**
 * Shared fetch helper for Cruise Control API calls.
 *
 * Uses window.fetch with credentials:'omit' to avoid stale session cookies.
 * Parses the response and categorises it into one of four outcomes:
 *   - empty:   CC returned an empty body
 *   - async:   CC returned a progress / async response (text/plain or has `progress` key)
 *   - error:   HTTP error (non-2xx)
 *   - success: valid JSON data
 *
 * @param {string} url
 * @param {object} [options]  Extra fetch options (e.g. headers for User-Task-ID)
 * @returns {Promise<{type: string, data: *, status: number, headers: Headers}>}
 */
export default function fetchCC (url, options) {
  const fetchOptions = Object.assign({ credentials: 'omit' }, options)

  return window.fetch(url, fetchOptions)
    .then(function (resp) {
      const contentType = resp.headers.get('content-type') || ''
      return resp.text().then(function (text) {
        return { text, contentType, ok: resp.ok, status: resp.status, headers: resp.headers }
      })
    })
    .then(function (resp) {
      let data
      try { data = JSON.parse(resp.text) } catch (e) { data = resp.text }

      if (data === null || data === undefined || data === '') {
        return { type: 'empty', data, status: resp.status, headers: resp.headers }
      }
      if (resp.contentType.match(/text\/plain/) || (data && data.progress)) {
        return { type: 'async', data, status: resp.status, headers: resp.headers }
      }
      if (!resp.ok) {
        return { type: 'error', data, status: resp.status, headers: resp.headers }
      }
      return { type: 'success', data, status: resp.status, headers: resp.headers }
    })
}
