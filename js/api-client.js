(function () {
  const inflight = {};
  const MAX_GET_URL_LEN = 7500;

  function getApiUrl() {
    return (window.EMD_GAS_API_URL || '').replace(/\/$/, '');
  }

  function buildQuery(action, args, token) {
    return new URLSearchParams({
      action: action,
      args: JSON.stringify(args || []),
      token: token || ''
    });
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
      throw new Error('คำขอ POST ไม่สมบูรณ์ (411) — ระบบจะใช้ GET แทน กรุณารีเฟรชหน้าเว็บ');
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
    const payload = JSON.stringify({ action: action, args: args || [], token: token || '' });
    const body = new TextEncoder().encode(payload);
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: body,
      redirect: 'follow',
      cache: 'no-store'
    }).then(handleFetchResponse);
  }

  window.emdApiRequest = function (action, args, token) {
    const key = requestKey(action, args, token);
    if (inflight[key]) return inflight[key];

    const url = getApiUrl();
    if (!url) return Promise.reject(new Error('ยังไม่ได้ตั้งค่า EMD_GAS_API_URL ใน config.js'));

    const qs = buildQuery(action, args, token);
    const fullLen = url.length + 1 + qs.toString().length;
    const run = fullLen < MAX_GET_URL_LEN
      ? emdApiGet(action, args, token)
      : emdApiPost(action, args, token);

    inflight[key] = run.finally(function () {
      delete inflight[key];
    });
    return inflight[key];
  };

  window.apiCall = function (action, args, token) {
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
