(function () {
  const inflight = {};
  const MAX_GET_URL_LEN = 7500;
  const REQUEST_TIMEOUT_MS = 45000;
  const RETRY_DELAY_MS = 450;
  const MUTATION_ACTIONS = new Set([
    'saveVehicle', 'saveVehicleManagement', 'deleteVehicle', 'saveBooking', 'deleteBooking',
    'quickUpdateMileage', 'saveAdminSettings', 'saveNameOption', 'saveManagedName', 'deleteManagedName',
    'recordVehicleHandover', 'setVehicleTcLineNotify', 'setVehicleTcOptions', 'moveVehiclesToGroup'
  ]);

  function getApiUrl() {
    return (window.EMD_GAS_API_URL || '').replace(/\/$/, '');
  }

  function getClientIp() {
    return window.EMD_CLIENT_IP || '';
  }

  function newRequestId() {
    try {
      if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
      if (window.crypto && typeof window.crypto.getRandomValues === 'function') {
        const bytes = window.crypto.getRandomValues(new Uint8Array(16));
        return Array.prototype.map.call(bytes, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
      }
    } catch (e) {}
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
  }

  function buildQuery(action, args, token, requestId) {
    const params = {
      action: action,
      args: JSON.stringify(args || []),
      token: token || '',
      emdToken: token || ''
    };
    if (MUTATION_ACTIONS.has(action)) {
      const ip = getClientIp();
      if (ip) params.clientIp = ip;
    }
    if (requestId) params.requestId = requestId;
    return new URLSearchParams(params);
  }

  function parseResponse(text) {
    if (!text) throw new Error('ไม่ได้รับข้อมูลจากเซิร์ฟเวอร์');
    const trimmed = String(text).trim();
    if (trimmed.charAt(0) === '<') {
      throw new Error('เซิร์ฟเวอร์ตอบกลับไม่ถูกต้อง — ลองรีเฟรชหรือตรวจสอบการ deploy ของ Apps Script');
    }
    try {
      return JSON.parse(trimmed);
    } catch (e) {
      throw new Error('ข้อมูลจากเซิร์ฟเวอร์อ่านไม่ได้ (JSON ไม่ถูกต้อง)');
    }
  }

  function httpError(message, status) {
    const err = new Error(message);
    err.status = status;
    return err;
  }

  function failHttp(status, text) {
    const body = String(text || '');
    if (status === 411) {
      throw httpError('คำขอ POST ไม่สมบูรณ์ (411)', 411);
    }
    if (status === 502 || status === 503 || status === 504) {
      throw httpError('เซิร์ฟเวอร์ Google ชั่วคราวไม่พร้อม (' + status + ') — ลองใหม่อีกครั้ง', status);
    }
    if (body.trim().charAt(0) === '<') {
      throw httpError('เซิร์ฟเวอร์ตอบกลับไม่ถูกต้อง — ลองรีเฟรชหรือตรวจสอบการ deploy ของ Apps Script', status);
    }
    throw httpError('เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ (HTTP ' + status + ')', status);
  }

  function handleFetchResponse(res) {
    return res.text().then(function (text) {
      if (!res.ok) failHttp(res.status, text);
      return parseResponse(text);
    });
  }

  /**
   * Errors worth retrying: fetch() itself failed (connection dropped), timed out,
   * or Google returned 411/502/503/504. Mutations are only retried because every
   * attempt carries the same requestId, which the server uses to run them once.
   */
  function isRetryableError(err) {
    if (!err) return false;
    if (err.isNetworkError || err.isTimeout) return true;
    return err.status === 411 || err.status === 502 || err.status === 503 || err.status === 504;
  }

  function delay(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function timeoutError() {
    const err = new Error('เซิร์ฟเวอร์ไม่ตอบสนอง (หมดเวลา) — ลองใหม่อีกครั้ง');
    err.isTimeout = true;
    return err;
  }

  function fetchWithTimeout(url, init) {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const opts = Object.assign({}, init);
    if (controller) opts.signal = controller.signal;
    let timer = null;

    const fetched = fetch(url, opts).catch(function (cause) {
      if (controller && controller.signal.aborted) throw timeoutError();
      const err = new Error('เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ — ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่');
      err.isNetworkError = true;
      err.cause = cause;
      throw err;
    }).then(handleFetchResponse);

    const timeout = new Promise(function (_, reject) {
      timer = setTimeout(function () {
        if (controller) controller.abort();
        reject(timeoutError());
      }, REQUEST_TIMEOUT_MS);
    });

    return Promise.race([fetched, timeout]).finally(function () {
      clearTimeout(timer);
    });
  }

  function requestKey(action, args, token) {
    return action + '|' + JSON.stringify(args || []) + '|' + (token || '');
  }

  function emdApiGet(action, args, token, requestId) {
    const url = getApiUrl();
    if (!url) return Promise.reject(new Error('ยังไม่ได้ตั้งค่า EMD_GAS_API_URL ใน config.js'));
    const qs = buildQuery(action, args, token, requestId);
    return fetchWithTimeout(url + '?' + qs.toString(), {
      method: 'GET',
      credentials: 'omit',
      redirect: 'follow',
      cache: 'no-store'
    });
  }

  function emdApiPost(action, args, token, requestId) {
    const url = getApiUrl();
    if (!url) return Promise.reject(new Error('ยังไม่ได้ตั้งค่า EMD_GAS_API_URL ใน config.js'));
    const payload = { action: action, args: args || [], token: token || '', emdToken: token || '' };
    if (MUTATION_ACTIONS.has(action)) {
      const ip = getClientIp();
      if (ip) payload.clientIp = ip;
    }
    if (requestId) payload.requestId = requestId;
    const body = new TextEncoder().encode(JSON.stringify(payload));
    return fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: body,
      redirect: 'follow',
      cache: 'no-store'
    });
  }

  /** Run `primary` with retries on retryable errors, then the same for `fallback` (if given). */
  function attempt(primary, fallback, retries) {
    function tryWithRetry(fn, left) {
      return fn().catch(function (err) {
        if (left <= 0 || !isRetryableError(err)) throw err;
        return delay(RETRY_DELAY_MS).then(function () { return tryWithRetry(fn, left - 1); });
      });
    }
    return tryWithRetry(primary, retries).catch(function (err) {
      if (!fallback || !isRetryableError(err)) throw err;
      return tryWithRetry(fallback, retries);
    });
  }

  window.emdTakePrefetch = function (action, token) {
    const pre = window.__emdPrefetch;
    if (!pre || pre.action !== action || pre.token !== (token || '') || !pre.promise) return null;
    window.__emdPrefetch = null;
    return pre.promise.then(function (packed) {
      if (!packed || !packed.ok) failHttp(packed ? packed.status : 0, packed && packed.text);
      return parseResponse(packed.text);
    });
  };

  window.emdApiRequest = function (action, args, token) {
    const key = requestKey(action, args, token);
    if (inflight[key]) return inflight[key];

    const url = getApiUrl();
    if (!url) return Promise.reject(new Error('ยังไม่ได้ตั้งค่า EMD_GAS_API_URL ใน config.js'));

    const isMutation = MUTATION_ACTIONS.has(action);
    // One id per logical request: every retry/fallback reuses it so the server runs it once.
    const requestId = isMutation ? newRequestId() : '';
    const qs = buildQuery(action, args, token, requestId);
    const canGet = url.length + 1 + qs.toString().length < MAX_GET_URL_LEN;

    function post() { return emdApiPost(action, args, token, requestId); }
    function get() { return emdApiGet(action, args, token, requestId); }

    // Mutations prefer POST (more reliable for Apps Script); reads prefer GET.
    const run = isMutation
      ? attempt(post, canGet ? get : null, 1)
      : attempt(canGet ? get : post, canGet ? post : null, 1);

    inflight[key] = run.finally(function () {
      delete inflight[key];
    });
    return inflight[key];
  };

  window.apiCall = function (action, args, token) {
    if (!token && typeof window.getEmdApiToken === 'function') {
      token = window.getEmdApiToken(action) || '';
    }
    return window.emdApiRequest(action, args, token);
  };

  window.apiCallSafe = function (action, args, token) {
    return window.apiCall(action, args, token).catch(function (err) {
      const msg = (err && err.message) ? err.message : 'เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ';
      if (typeof Swal !== 'undefined') {
        Swal.fire('ผิดพลาด', msg, 'error');
      }
      throw err;
    });
  };
})();
