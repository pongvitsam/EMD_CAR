(function () {
  const inflight = {};
  const MAX_GET_URL_LEN = 7500;
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

  function buildQuery(action, args, token) {
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

  function failHttp(status, text) {
    const body = String(text || '');
    if (status === 411 || /411/.test(body)) {
      const err = new Error('คำขอ POST ไม่สมบูรณ์ (411)');
      err.code = 411;
      throw err;
    }
    if (status === 502 || /502/.test(body)) {
      throw new Error('เซิร์ฟเวอร์ Google ชั่วคราวไม่พร้อม (502) — ลองใหม่อีกครั้ง');
    }
    if (body.trim().charAt(0) === '<') {
      throw new Error('เซิร์ฟเวอร์ตอบกลับไม่ถูกต้อง — ลองรีเฟรชหรือตรวจสอบการ deploy ของ Apps Script');
    }
    throw new Error('เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ (HTTP ' + status + ')');
  }

  function handleFetchResponse(res) {
    return res.text().then(function (text) {
      if (!res.ok) failHttp(res.status, text);
      return parseResponse(text);
    });
  }

  function isTransientNetworkError(err) {
    if (!err) return false;
    if (err.code === 411) return true;
    const msg = String(err.message || err.name || '').toLowerCase();
    return (
      err.name === 'TypeError' ||
      msg.indexOf('failed to fetch') !== -1 ||
      msg.indexOf('network') !== -1 ||
      msg.indexOf('connection') !== -1 ||
      msg.indexOf('err_connection') !== -1 ||
      msg.indexOf('load failed') !== -1 ||
      msg.indexOf('411') !== -1
    );
  }

  function delay(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function requestKey(action, args, token) {
    return action + '|' + JSON.stringify(args || []) + '|' + (token || '');
  }

  function emdApiGet(action, args, token) {
    const url = getApiUrl();
    if (!url) return Promise.reject(new Error('ยังไม่ได้ตั้งค่า EMD_GAS_API_URL ใน config.js'));
    const qs = buildQuery(action, args, token);
    return fetch(url + '?' + qs.toString(), {
      method: 'GET',
      credentials: 'omit',
      redirect: 'follow',
      cache: 'no-store'
    }).then(handleFetchResponse);
  }

  function emdApiPost(action, args, token) {
    const url = getApiUrl();
    if (!url) return Promise.reject(new Error('ยังไม่ได้ตั้งค่า EMD_GAS_API_URL ใน config.js'));
    const payload = { action: action, args: args || [], token: token || '', emdToken: token || '' };
    if (MUTATION_ACTIONS.has(action)) {
      const ip = getClientIp();
      if (ip) payload.clientIp = ip;
    }
    const body = new TextEncoder().encode(JSON.stringify(payload));
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: body,
      redirect: 'follow',
      cache: 'no-store'
    }).then(handleFetchResponse);
  }

  function withRetry(fn, retries) {
    return fn().catch(function (err) {
      if (retries <= 0 || !isTransientNetworkError(err)) throw err;
      return delay(450).then(function () { return withRetry(fn, retries - 1); });
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

    const qs = buildQuery(action, args, token);
    const fullLen = url.length + 1 + qs.toString().length;
    const isMutation = MUTATION_ACTIONS.has(action);
    const canGet = fullLen < MAX_GET_URL_LEN;

    let run;
    if (isMutation) {
      // Mutations: POST first (more reliable for Apps Script), fall back to GET if needed
      run = withRetry(function () { return emdApiPost(action, args, token); }, 1)
        .catch(function (err) {
          if (!canGet || !isTransientNetworkError(err)) throw err;
          return withRetry(function () { return emdApiGet(action, args, token); }, 1);
        });
    } else if (canGet) {
      run = withRetry(function () { return emdApiGet(action, args, token); }, 1)
        .catch(function (err) {
          if (!isTransientNetworkError(err)) throw err;
          return emdApiPost(action, args, token);
        });
    } else {
      run = withRetry(function () { return emdApiPost(action, args, token); }, 1);
    }

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
