// URL จาก Apps Script > Deploy > Web app (/exec)
window.EMD_GAS_API_URL = 'https://script.google.com/macros/s/AKfycbzPf0bbISEeGRFYmyv_shbluRy7nWvAvahotgKyMTlJ0TB1nYbw63CXKu5prYsaVt5i/exec';

(function () {
  try {
    const u = new URL(window.EMD_GAS_API_URL);
    const link = document.createElement('link');
    link.rel = 'preconnect';
    link.href = u.origin;
    link.crossOrigin = 'anonymous';
    document.head.appendChild(link);
    const dns = document.createElement('link');
    dns.rel = 'dns-prefetch';
    dns.href = u.origin;
    document.head.appendChild(dns);
  } catch (e) {}
})();
