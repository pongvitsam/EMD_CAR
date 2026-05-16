(function () {
  const READ_ACTIONS = new Set(['getAppData', 'getAppLogs', 'getNameManagementData']);
  const inflight = {};

  function getApiUrl() {
    return (window.EMD_GAS_API_URL || '').replace(/\/$/, '');
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

  function requestKey(action, args, token) {
    return action + '|' + JSON.stringify(args || []) + '|' + (token || '');
  }

  function emdApiGet(action, args, token) {
    const url = getApiUrl();
    if (!url) return Promise.reject(new Error('ยังไม่ได้ตั้งค่า EMD_GAS_API_URL ใน config.js'));
    const qs = new URLSearchParams({
      action: action,
      args: JSON.stringify(args || []),
      token: token || ''
    });
    return fetch(url + '?' + qs.toString(), {
      method: 'GET',
      credentials: 'omit',
      redirect: 'follow',
      cache: 'no-store'
    }).then(function (res) {
      return res.text();
    }).then(parseResponse);
  }

  function emdApiPost(action, args, token) {
    const url = getApiUrl();
    if (!url) return Promise.reject(new Error('ยังไม่ได้ตั้งค่า EMD_GAS_API_URL ใน config.js'));
    const payload = JSON.stringify({ action: action, args: args || [], token: token || '' });
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: payload,
      redirect: 'follow',
      cache: 'no-store'
    }).then(function (res) {
      return res.text();
    }).then(parseResponse);
  }

  window.emdApiRequest = function (action, args, token) {
    const key = requestKey(action, args, token);
    if (inflight[key]) return inflight[key];

    const run = READ_ACTIONS.has(action)
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
