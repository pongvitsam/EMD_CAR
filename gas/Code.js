const SHEET_ID = '1W5XJ6_JIFr4UHSLWsjb_YfpbF6He7Crz7Vrcdbbqaw8';
const DRIVE_FOLDER_ID = '1R7JySsplPoCZI_Kjq51GAukOKUAzJhKz'; 
const ADMIN_EMAIL = 'admin@yourdomain.com';
const APP_DATA_CACHE_KEY = 'APP_DATA_V2';
const APP_DATA_CORE_CACHE_KEY = 'APP_DATA_CORE_V2';
const APP_LOGS_CACHE_KEY = 'APP_LOGS_V1';
const LEGACY_APP_DATA_CACHE_KEY = 'APP_DATA_V1';
const CACHE_TTL_SEC = 120;
const LOGS_CACHE_TTL_SEC = 90;
const ADMIN_SESSION_CACHE_PREFIX = 'ADMIN_SESSION_';
const VEHICLE_HEADERS = ['Vehicle_ID', 'ทะเบียน', 'รูปรถ(URL)', 'ประเภท', 'Email', 'Password', 'ระยะ Service (km)', 'ไมล์ล่าสุด (km)', 'จุดจอดล่าสุด', 'พรบ.หมดอายุ', 'หมายเหตุ', 'สถานะ', 'วันคืนรถ/หมดสัญญา', 'วันที่เช็คระยะล่าสุด', 'กม.เช็คระยะล่าสุด', 'ผู้นำเข้าเช็คระยะ', 'ระยะกม.ต่อรอบ', 'ประวัติเช็คระยะ(JSON)', 'แผนรอบถัดไป(JSON)'];
const DEFAULT_SERVICE_INTERVAL_KM = 10000;

function getSpreadsheet_() {
  return SpreadsheetApp.openById(SHEET_ID);
}

function getSheetOrThrow_(ss, sheetName) {
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) throw new Error('ไม่พบชีต: ' + sheetName);
  return sheet;
}

function parseTimeSafe_(val) {
  if (!val) return 0;
  if (val instanceof Date) return val.getTime();
  const s = String(val).trim();
  if (!s) return 0;
  if (s.endsWith('Z') || /([+-]\d{2}:\d{2})$/.test(s)) {
    const dIso = new Date(s);
    if (!isNaN(dIso.getTime())) return dIso.getTime();
  }
  let clean = s.replace('T', ' ').replace(/-/g, '/');
  if (clean.length === 16) clean += ':00';
  const d = new Date(clean);
  if (!isNaN(d.getTime())) return d.getTime();
  const fallback = new Date(s);
  return isNaN(fallback.getTime()) ? 0 : fallback.getTime();
}

function clearAppCache_() {
  const cache = CacheService.getScriptCache();
  cache.remove(APP_DATA_CACHE_KEY);
  cache.remove(APP_DATA_CORE_CACHE_KEY);
  cache.remove(APP_LOGS_CACHE_KEY);
  cache.remove(LEGACY_APP_DATA_CACHE_KEY);
}

function createAdminSession_() {
  const token = Utilities.getUuid();
  CacheService.getScriptCache().put(ADMIN_SESSION_CACHE_PREFIX + token, '1', 7200);
  return token;
}

function requireAdminSession_(token) {
  if (!token || CacheService.getScriptCache().get(ADMIN_SESSION_CACHE_PREFIX + token) !== '1') {
    throw new Error('กรุณาเข้าสู่ระบบ Admin อีกครั้ง');
  }
  CacheService.getScriptCache().put(ADMIN_SESSION_CACHE_PREFIX + token, '1', 7200);
}

function getNameRows_() {
  const ss = getSpreadsheet_();
  setupDatabase();
  const sheet = getSheetOrThrow_(ss, 'Name');
  const data = sheet.getDataRange().getValues();
  return data.slice(1).map((r, idx) => ({
    row: idx + 2,
    fname: r[0] || '',
    lname: r[1] || '',
    fullName: String((r[0] || '') + ' ' + (r[1] || '')).trim().replace(/\s+/g, ' '),
    dept: r[2] || ''
  })).filter(r => r.fullName || r.dept);
}

function getCurrentUserEmail_() {
  return Session.getActiveUser().getEmail();
}

function attachCurrentUser_(payload) {
  const data = Object.assign({}, payload || {});
  data.currentUserEmail = getCurrentUserEmail_();
  return data;
}

function ensureVehiclesSheet_(ss) {
  let sheet = ss.getSheetByName('Vehicles');
  if (!sheet) {
    sheet = ss.insertSheet('Vehicles');
    sheet.appendRow(VEHICLE_HEADERS);
    return sheet;
  }

  const leaseHeaderCell = sheet.getRange(1, 13);
  if (!leaseHeaderCell.getValue()) {
    leaseHeaderCell.setValue(VEHICLE_HEADERS[12]);
  }
  for (let c = 14; c <= VEHICLE_HEADERS.length; c++) {
    const cell = sheet.getRange(1, c);
    if (!cell.getValue()) cell.setValue(VEHICLE_HEADERS[c - 1]);
  }
  return sheet;
}

function vehicleFormField_(form, key, row, colIndex, fallback) {
  if (form && Object.prototype.hasOwnProperty.call(form, key) && form[key] !== undefined && form[key] !== null && String(form[key]).trim() !== '') {
    return form[key];
  }
  if (row && row[colIndex] !== undefined && row[colIndex] !== null && String(row[colIndex]).trim() !== '') {
    return row[colIndex];
  }
  return fallback;
}

function parseVehicleServiceHistory_(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(item => item && typeof item === 'object');
  } catch (err) {
    return [];
  }
}

function parseVehicleServiceRoundPlan_(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map(function (n) { return Math.round(parseFloat(n) || 0); }).filter(function (n) { return n > 0; });
  }
  try {
    const parsed = JSON.parse(String(value));
    if (!Array.isArray(parsed)) return [];
    return parsed.map(function (n) { return Math.round(parseFloat(n) || 0); }).filter(function (n) { return n > 0; });
  } catch (err) {
    return [];
  }
}

function normalizeServiceHistoryItem_(item, fallbackIntervalKm) {
  const safeInterval = parseFloat(fallbackIntervalKm) || DEFAULT_SERVICE_INTERVAL_KM;
  return {
    serviceDate: String(item && item.serviceDate ? item.serviceDate : ''),
    serviceKm: parseFloat(item && item.serviceKm) || 0,
    nextDueKm: parseFloat(item && item.nextDueKm) || 0,
    serviceBy: String(item && item.serviceBy ? item.serviceBy : ''),
    intervalKm: parseFloat(item && item.intervalKm) || safeInterval,
    roundNumber: parseInt(item && item.roundNumber, 10) || 0,
    roundDueKm: parseFloat(item && item.roundDueKm) || 0,
    recordedAt: String(item && item.recordedAt ? item.recordedAt : '')
  };
}

function buildVehicleRowValues_(form, row, imgUrl, activeStatus) {
  const safeEmail = vehicleFormField_(form, 'email', row, 4, '');
  const safePass = vehicleFormField_(form, 'pass', row, 5, '');
  const intervalKm = parseFloat(vehicleFormField_(form, 'serviceIntervalKm', row, 16, DEFAULT_SERVICE_INTERVAL_KM)) || DEFAULT_SERVICE_INTERVAL_KM;
  const historyJson = vehicleFormField_(form, 'serviceHistoryJson', row, 17, '[]');
  const roundPlanJson = vehicleFormField_(form, 'serviceRoundPlanJson', row, 18, '[]');
  return [
    vehicleFormField_(form, 'plate', row, 1, ''),
    imgUrl,
    vehicleFormField_(form, 'type', row, 3, ''),
    safeEmail,
    safePass,
    vehicleFormField_(form, 'serviceMile', row, 6, 0),
    vehicleFormField_(form, 'currentMile', row, 7, 0),
    vehicleFormField_(form, 'parkingSpot', row, 8, ''),
    vehicleFormField_(form, 'actExpiry', row, 9, ''),
    vehicleFormField_(form, 'remarks', row, 10, ''),
    activeStatus,
    vehicleFormField_(form, 'leaseExpiry', row, 12, ''),
    vehicleFormField_(form, 'serviceLastDate', row, 13, ''),
    vehicleFormField_(form, 'serviceLastKm', row, 14, ''),
    vehicleFormField_(form, 'serviceLastBy', row, 15, ''),
    intervalKm,
    historyJson,
    roundPlanJson
  ];
}

function doGet(e) {
  const params = e && e.parameter ? e.parameter : {};
  if (params.action) {
    try {
      let args = [];
      if (params.args) {
        try {
          args = JSON.parse(params.args);
        } catch (parseErr) {
          return jsonOutput_({ success: false, msg: 'รูปแบบ args ไม่ถูกต้อง' });
        }
      }
      if (!Array.isArray(args)) args = [];
      return jsonOutput_(dispatchApi_(params.action, args, params.token || ''));
    } catch (err) {
      return jsonOutput_({ success: false, msg: String(err.message || err) });
    }
  }
  return HtmlService.createHtmlOutputFromFile('Index')
      .setTitle('🚗 EMD CAR 🚗')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const action = body.action;
    if (!action) return jsonOutput_({ success: false, msg: 'ไม่ระบุ action' });
    const args = Array.isArray(body.args) ? body.args : [];
    const result = dispatchApi_(action, args, body.token || '');
    return jsonOutput_(result);
  } catch (err) {
    return jsonOutput_({ success: false, msg: String(err.message || err) });
  }
}

function jsonOutput_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
      .setMimeType(ContentService.MimeType.JSON);
}

function dispatchApi_(action, args, token) {
  args = Array.isArray(args) ? args : [];
  switch (action) {
    case 'getAppData': return getAppData(!(args.length > 0 && args[0] === false));
    case 'getAppLogs': return getAppLogs_();
    case 'verifyAdminLogin': return verifyAdminLogin(args[0], args[1]);
    case 'saveAdminSettings': return saveAdminSettings(args[0]);
    case 'getNameManagementData': return getNameManagementData(token);
    case 'saveManagedName': return saveManagedName(token, args[0]);
    case 'deleteManagedName': return deleteManagedName(token, args[0]);
    case 'saveNameOption': return saveNameOption(args[0]);
    case 'saveVehicle': return saveVehicle(args[0]);
    case 'saveVehicleManagement': return saveVehicleManagement(token, args[0]);
    case 'deleteVehicle': return deleteVehicle(args[0], args[1]);
    case 'saveBooking': return saveBooking(args[0]);
    case 'deleteBooking': return deleteBooking(args[0]);
    case 'quickUpdateMileage': return quickUpdateMileage(args[0], args[1], args[2]);
    default: throw new Error('Unknown action: ' + action);
  }
}

function setupDatabase() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  if (!ss.getSheetByName('Name')) ss.insertSheet('Name').appendRow(['ชื่อ', 'นามสกุล', 'แผนก']);
  ensureVehiclesSheet_(ss);
  if (!ss.getSheetByName('Bookings')) ss.insertSheet('Bookings').appendRow(['Booking_ID', 'ทะเบียนรถ', 'ชื่อ', 'นามสกุล', 'แผนก', 'เริ่ม', 'สิ้นสุด', 'จุดหมาย', 'ผู้ขับขี่', 'อีเมลผู้บันทึก', 'ไมล์ก่อนใช้', 'ไมล์หลังใช้', 'จุดจอดหลังใช้งาน']);
  if (!ss.getSheetByName('Logs')) ss.insertSheet('Logs').appendRow(['Timestamp', 'อีเมลผู้ทำรายการ', 'Action', 'Target', 'รายละเอียด', 'เหตุผลการแก้ไข']);
  
  if (!ss.getSheetByName('Settings')) {
    const sSheet = ss.insertSheet('Settings');
    sSheet.appendRow(['Key', 'Value', 'Description']);
    sSheet.appendRow(['AdminUser', 'admin', 'ชื่อผู้ใช้สำหรับ Admin']);
    sSheet.appendRow(['AdminPass', '03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4', 'รหัสผ่าน Admin (Hash SHA-256)']);
    sSheet.appendRow(['BannerStatus', 'ON', 'สถานะ Banner (ON/OFF)']);
    sSheet.appendRow(['BannerText', 'ยินดีต้อนรับสู่ระบบจองรถ EMD CAR!', 'ข้อความแจ้งเตือนที่แสดงวิ่งด้านบน']);
    sSheet.appendRow(['MileageReminderExempt', '[]', 'รายชื่อยกเว้นแจ้งเตือนไมล์ (JSON array)']);
  }
}

function buildAppPayload_(ss, includeLogs) {
  const vData = getSheetOrThrow_(ss, 'Vehicles').getDataRange().getValues();
  const vehicles = vData.slice(1).map(r => ({
    id: r[0], plate: r[1], img: r[2], type: r[3], email: r[4], pass: r[5],
    serviceMile: parseFloat(r[6]) || 0, currentMile: parseFloat(r[7]) || 0,
    parkingSpot: r[8] || '', actExpiry: r[9], remarks: r[10] || '',
    status: r[11] || 'ACTIVE',
    leaseExpiry: r[12] || '',
    serviceLastDate: r[13] || '',
    serviceLastKm: parseFloat(r[14]) || 0,
    serviceLastBy: r[15] || '',
    serviceIntervalKm: parseFloat(r[16]) || DEFAULT_SERVICE_INTERVAL_KM,
    serviceHistory: parseVehicleServiceHistory_(r[17]),
    serviceRoundPlan: parseVehicleServiceRoundPlan_(r[18])
  }));

  const bDataVal = getSheetOrThrow_(ss, 'Bookings').getDataRange().getValues();
  const bookings = bDataVal.slice(1).map(r => ({
    id: r[0], plate: r[1], name: r[2], surname: r[3],
    dept: r[4], start: r[5], end: r[6], dest: r[7], driver: r[8],
    userEmail: r[9], startMile: r[10], endMile: r[11], parkingSpot: r[12] || ''
  }));

  const nData = getSheetOrThrow_(ss, 'Name').getDataRange().getValues();
  const names = nData.slice(1).map(r => ({ fullName: (r[0] || '') + ' ' + (r[1] || ''), dept: r[2] || '' }));

  let logs = [];
  if (includeLogs) logs = readLogsFromSheet_(ss);

  const sData = getSheetOrThrow_(ss, 'Settings').getDataRange().getValues();
  let settings = { bannerStatus: 'OFF', bannerText: '', mileageReminderExempt: [] };
  for (let i = 1; i < sData.length; i++) {
    if (sData[i][0] === 'BannerStatus') settings.bannerStatus = sData[i][1];
    if (sData[i][0] === 'BannerText') settings.bannerText = sData[i][1];
    if (sData[i][0] === 'MileageReminderExempt') settings.mileageReminderExempt = parseMileageReminderExempt_(sData[i][1]);
  }

  return { vehicles, bookings, names, logs, settings };
}

function parseMileageReminderExempt_(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(String(value));
    if (!Array.isArray(parsed)) return [];
    return parsed.map(function (n) {
      return String(n || '').trim().replace(/\s+/g, ' ');
    }).filter(function (n) { return n.length > 0; });
  } catch (err) {
    return [];
  }
}

function readLogsFromSheet_(ss) {
  const rawLogs = getSheetOrThrow_(ss, 'Logs').getDataRange().getValues();
  return rawLogs.slice(1).slice(-100).map(r => ({
    timestamp: r[0], email: r[1], action: r[2], target: r[3], detail: r[4], reason: r[5] || '-'
  })).reverse();
}

function getAppData(includeLogs) {
  const wantLogs = (includeLogs !== false);
  const cache = CacheService.getScriptCache();
  const cacheKey = wantLogs ? APP_DATA_CACHE_KEY : APP_DATA_CORE_CACHE_KEY;
  const cachedPayload = cache.get(cacheKey);
  if (cachedPayload) return attachCurrentUser_(JSON.parse(cachedPayload));

  const ss = getSpreadsheet_();
  setupDatabase();
  const normalized = JSON.parse(JSON.stringify(buildAppPayload_(ss, wantLogs)));
  cache.put(cacheKey, JSON.stringify(normalized), CACHE_TTL_SEC);
  if (wantLogs) {
    const coreOnly = Object.assign({}, normalized, { logs: [] });
    cache.put(APP_DATA_CORE_CACHE_KEY, JSON.stringify(coreOnly), CACHE_TTL_SEC);
  }
  return attachCurrentUser_(normalized);
}

function getAppLogs_() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(APP_LOGS_CACHE_KEY);
  if (cached) return { success: true, logs: JSON.parse(cached) };

  const ss = getSpreadsheet_();
  setupDatabase();
  const logs = readLogsFromSheet_(ss);
  cache.put(APP_LOGS_CACHE_KEY, JSON.stringify(logs), LOGS_CACHE_TTL_SEC);
  return { success: true, logs: logs };
}

function verifyAdminLogin(user, passText) {
  const ss = getSpreadsheet_();
  const sData = getSheetOrThrow_(ss, 'Settings').getDataRange().getValues();
  let savedUser = '', savedHash = '';
  
  for(let i=1; i<sData.length; i++) {
    if(sData[i][0] === 'AdminUser') savedUser = sData[i][1];
    if(sData[i][0] === 'AdminPass') savedHash = sData[i][1];
  }

  const rawHash = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, passText);
  const txtHash = rawHash.map(b => (b < 0 ? b + 256 : b).toString(16).padStart(2, '0')).join('');
  
  if(user === savedUser && txtHash === savedHash) return { success: true, token: createAdminSession_() };
  return { success: false, msg: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' };
}

function getNameManagementData(token) {
  try {
    requireAdminSession_(token);
    return { success: true, rows: getNameRows_() };
  } catch (error) { return { success: false, msg: error.message }; }
}

function saveManagedName(token, form) {
  try {
    requireAdminSession_(token);
    const fullName = String(form.fullName || '').trim().replace(/\s+/g, ' ');
    const dept = String(form.dept || '').trim();
    const row = Number(form.row) || 0;
    if (!fullName) return { success: false, msg: 'กรุณาระบุชื่อ-นามสกุล' };
    if (!dept) return { success: false, msg: 'กรุณาระบุแผนก' };

    const ss = getSpreadsheet_();
    setupDatabase();
    const sheet = getSheetOrThrow_(ss, 'Name');
    const rows = getNameRows_();
    const isDuplicate = rows.some(r => r.row !== row && r.fullName === fullName && String(r.dept).trim() === dept);
    if (isDuplicate) return { success: false, msg: 'มีรายชื่อและแผนกนี้อยู่แล้ว' };

    const nameParts = fullName.split(' ');
    const fname = nameParts[0] || '';
    const lname = nameParts.slice(1).join(' ') || '';
    if (row >= 2 && row <= sheet.getLastRow()) {
      sheet.getRange(row, 1, 1, 3).setValues([[fname, lname, dept]]);
    } else {
      sheet.appendRow([fname, lname, dept]);
    }

    clearAppCache_();
    return { success: true, msg: 'บันทึกรายชื่อ/แผนกเรียบร้อยครับ', rows: getNameRows_() };
  } catch (error) { return { success: false, msg: error.message }; }
}

function deleteManagedName(token, row) {
  try {
    requireAdminSession_(token);
    const ss = getSpreadsheet_();
    setupDatabase();
    const sheet = getSheetOrThrow_(ss, 'Name');
    const rowNumber = Number(row) || 0;
    if (rowNumber < 2 || rowNumber > sheet.getLastRow()) return { success: false, msg: 'ไม่พบรายชื่อที่ต้องการลบ' };
    sheet.deleteRow(rowNumber);
    clearAppCache_();
    return { success: true, msg: 'ลบรายชื่อเรียบร้อยครับ', rows: getNameRows_() };
  } catch (error) { return { success: false, msg: error.message }; }
}

function saveAdminSettings(form) {
  try {
    const ss = getSpreadsheet_();
    const sheet = getSheetOrThrow_(ss, 'Settings');
    const data = sheet.getDataRange().getValues();
    
    let updatedStatus = false, updatedText = false, updatedExempt = false;
    const exemptJson = form.mileageReminderExempt !== undefined
      ? JSON.stringify(parseMileageReminderExempt_(form.mileageReminderExempt))
      : null;
    for(let i=1; i<data.length; i++) {
      if(data[i][0] === 'BannerStatus') { sheet.getRange(i+1, 2).setValue(form.status); updatedStatus = true; }
      if(data[i][0] === 'BannerText') { sheet.getRange(i+1, 2).setValue(form.text); updatedText = true; }
      if (exemptJson !== null && data[i][0] === 'MileageReminderExempt') {
        sheet.getRange(i + 1, 2).setValue(exemptJson);
        updatedExempt = true;
      }
    }
    
    if(!updatedStatus) sheet.appendRow(['BannerStatus', form.status]);
    if(!updatedText) sheet.appendRow(['BannerText', form.text]);
    if (exemptJson !== null && !updatedExempt) sheet.appendRow(['MileageReminderExempt', exemptJson]);
    clearAppCache_();
    
    return { success: true, msg: 'บันทึกการตั้งค่าระบบเรียบร้อยครับ' };
  } catch (error) { return { success: false, msg: error.message }; }
}

function saveNameOption(form) {
  try {
    const fullName = String(form.fullName || '').trim().replace(/\s+/g, ' ');
    const dept = String(form.dept || '').trim();
    if (!fullName) return { success: false, msg: 'กรุณาระบุชื่อ-นามสกุล' };
    if (!dept) return { success: false, msg: 'กรุณาระบุแผนก' };

    const ss = getSpreadsheet_();
    const sheet = getSheetOrThrow_(ss, 'Name');
    const data = sheet.getDataRange().getValues();
    const nameParts = fullName.split(' ');
    const fname = nameParts[0] || '';
    const lname = nameParts.slice(1).join(' ') || '';

    for (let i = 1; i < data.length; i++) {
      const existingFullName = String((data[i][0] || '') + ' ' + (data[i][1] || '')).trim().replace(/\s+/g, ' ');
      const existingDept = String(data[i][2] || '').trim();
      if (existingFullName === fullName && existingDept === dept) {
        return { success: true, msg: 'มีรายชื่อนี้ใน dropdown อยู่แล้วครับ', fullName, dept };
      }
    }

    sheet.appendRow([fname, lname, dept]);
    clearAppCache_();
    return { success: true, msg: 'เพิ่มรายชื่อใน dropdown เรียบร้อยครับ', fullName, dept };
  } catch (error) { return { success: false, msg: error.message }; }
}

function uploadImageToDrive(base64Data, filename) {
  if (!base64Data) return "";
  if (base64Data.startsWith("http")) return base64Data; 
  try {
    const folder = DriveApp.getFolderById(DRIVE_FOLDER_ID);
    const blob = Utilities.newBlob(Utilities.base64Decode(base64Data.split(',')[1]), 'image/jpeg', filename + ".jpg");
    const file = folder.createFile(blob);
    try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch(e) {}
    return "https://drive.google.com/thumbnail?id=" + file.getId() + "&sz=w800";
  } catch(e) { throw new Error("Drive Error: " + e.message); }
}

function saveVehicleManagement(token, form) {
  requireAdminSession_(token);
  return saveVehicle(form);
}

function saveVehicle(form) {
  try {
    const ss = getSpreadsheet_();
    setupDatabase();
    const sheet = getSheetOrThrow_(ss, 'Vehicles');
    const logSheet = getSheetOrThrow_(ss, 'Logs');
    const actionEmail = Session.getActiveUser().getEmail() || 'Unknown User';
    
    let imgUrl = form.existingImg;
    if (form.imageBase64 && form.imageBase64.trim() !== '') {
      imgUrl = uploadImageToDrive(form.imageBase64, (form.plate || 'vehicle') + "_image_" + new Date().getTime());
    }

    const activeStatus = vehicleFormField_(form, 'status', null, 0, 'ACTIVE');

    if (form.id) {
      const data = sheet.getDataRange().getValues();
      for (let i = 1; i < data.length; i++) {
        if (data[i][0] == form.id) {
          const row = data[i];
          const isHistoryNextDueUpdate = String(form.managementAction || '') === 'แก้ไขรอบถัดไปประวัติ'
            && form.serviceHistoryEditIndex !== undefined
            && form.serviceHistoryEditIndex !== ''
            && form.serviceMile !== undefined;
          if (isHistoryNextDueUpdate) {
            const history = parseVehicleServiceHistory_(row[17]).map(function (item) {
              return normalizeServiceHistoryItem_(item, form.serviceIntervalKm || row[16]);
            });
            const editIndexRaw = Number(form.serviceHistoryEditIndex);
            if (!isNaN(editIndexRaw) && editIndexRaw >= 0 && editIndexRaw < history.length) {
              history[editIndexRaw].nextDueKm = parseFloat(form.serviceMile) || 0;
              form.serviceHistoryJson = JSON.stringify(history.slice(0, 30));
              if (editIndexRaw === 0) {
                form.serviceMile = history[0].nextDueKm;
                if (form.serviceRoundPlan && Array.isArray(form.serviceRoundPlan) && form.serviceRoundPlan.length) {
                  form.serviceRoundPlan[0] = history[0].nextDueKm;
                  form.serviceRoundPlanJson = JSON.stringify(form.serviceRoundPlan);
                }
              }
            }
          }
          const isPlanUpdate = String(form.managementAction || '') === 'ตั้งแผนเช็คระยะ';
          if (isPlanUpdate && form.serviceRoundPlan && Array.isArray(form.serviceRoundPlan)) {
            const cleaned = form.serviceRoundPlan.map(function (n) { return Math.round(parseFloat(n) || 0); }).filter(function (n) { return n > 0; });
            form.serviceRoundPlanJson = JSON.stringify(cleaned.slice(0, 10));
            if (cleaned.length > 0) form.serviceMile = cleaned[0];
          }
          const isServiceRecordUpdate = String(form.managementAction || '') === 'บันทึกเข้าศูนย์เช็คระยะ'
            && form.serviceLastDate
            && form.serviceLastKm !== undefined
            && form.serviceMile !== undefined;
          if (isServiceRecordUpdate) {
            const history = parseVehicleServiceHistory_(row[17]).map(function (item) {
              return normalizeServiceHistoryItem_(item, form.serviceIntervalKm);
            });
            const editIndexRaw = Number(form.serviceHistoryEditIndex);
            const hasEditIndex = !isNaN(editIndexRaw) && editIndexRaw >= 0 && editIndexRaw < history.length;
            const editedItem = {
              serviceDate: String(form.serviceLastDate || ''),
              serviceKm: parseFloat(form.serviceLastKm) || 0,
              nextDueKm: parseFloat(form.serviceMile) || 0,
              serviceBy: String(form.serviceLastBy || ''),
              intervalKm: parseFloat(form.serviceIntervalKm) || DEFAULT_SERVICE_INTERVAL_KM,
              roundNumber: parseInt(form.serviceRoundNumber, 10) || 0,
              roundDueKm: parseFloat(form.serviceRoundDueKm) || 0,
              recordedAt: new Date().toISOString()
            };
            if (hasEditIndex) {
              history[editIndexRaw] = editedItem;
            } else {
              history.unshift(editedItem);
            }
            if (history.length > 0) {
              const latest = normalizeServiceHistoryItem_(history[0], form.serviceIntervalKm);
              form.serviceLastDate = latest.serviceDate;
              form.serviceLastKm = latest.serviceKm;
              form.serviceLastBy = latest.serviceBy;
              form.serviceMile = latest.nextDueKm;
              form.serviceIntervalKm = latest.intervalKm;
            }
            form.serviceHistoryJson = JSON.stringify(history.slice(0, 30));
            const planFromRecord = [parseFloat(form.serviceMile) || 0];
            const intervalForPlan = parseFloat(form.serviceIntervalKm) || DEFAULT_SERVICE_INTERVAL_KM;
            for (let p = 1; p < 5; p++) planFromRecord.push(Math.round(planFromRecord[0] + p * intervalForPlan));
            form.serviceRoundPlanJson = JSON.stringify(planFromRecord.filter(function (n) { return n > 0; }));
          }
          if (!imgUrl) imgUrl = row[2] || '';
          const values = buildVehicleRowValues_(form, row, imgUrl, activeStatus);
          sheet.getRange(i + 1, 2, 1, values.length).setValues([values]);
          clearAppCache_();
          const plate = values[0] || row[1];
          const detail = form.managementAction ? String(form.managementAction) : `อัปเดตข้อมูลรถ/สถานะ (${activeStatus})`;
          logSheet.appendRow([new Date(), actionEmail, 'UPDATE_VEHICLE', plate, detail, form.editReason || '-']);
          return {success: true, msg: 'อัปเดตข้อมูลรถเรียบร้อยครับ'};
        }
      }
    } else {
      const newId = 'V_' + new Date().getTime();
      const values = buildVehicleRowValues_(form, [], imgUrl || '', activeStatus);
      sheet.appendRow([newId].concat(values));
      clearAppCache_();
      logSheet.appendRow([new Date(), actionEmail, 'ADD_VEHICLE', values[0], 'เพิ่มรถใหม่เข้าระบบ', '-']);
      return {success: true, msg: 'เพิ่มรถเข้าระบบเรียบร้อยครับ'};
    }
  } catch (error) { return {success: false, msg: error.message}; }
}

function deleteVehicle(id, mode) {
  try {
    const ss = getSpreadsheet_();
    const vSheet = getSheetOrThrow_(ss, 'Vehicles');
    const vData = vSheet.getDataRange().getValues();
    const actionEmail = Session.getActiveUser().getEmail() || 'Unknown User';
    
    for (let i = 1; i < vData.length; i++) {
      if (vData[i][0] == id) {
        const plate = vData[i][1];
        
        if (mode === 'HARD') {
          vSheet.deleteRow(i + 1);
          const bSheet = getSheetOrThrow_(ss, 'Bookings');
          const bData = bSheet.getDataRange().getValues();
          let deletedCount = 0;
          for (let j = bData.length - 1; j >= 1; j--) { 
            if (bData[j][1] == plate) {
              bSheet.deleteRow(j + 1);
              deletedCount++;
            }
          }
          clearAppCache_();
          getSheetOrThrow_(ss, 'Logs').appendRow([new Date(), actionEmail, 'HARD_DELETE', plate, `ลบรถ+ประวัติการจองถาวร (${deletedCount} รายการ)`, 'Admin ลบรถถาวร']);
          return {success: true, msg: 'ลบรถและประวัติการจองทั้งหมดแบบถาวรแล้วครับ'};
          
        } else {
          vSheet.getRange(i + 1, 12).setValue('HIDDEN');
          clearAppCache_();
          getSheetOrThrow_(ss, 'Logs').appendRow([new Date(), actionEmail, 'SOFT_DELETE', plate, `ซ่อนรถออกจากระบบ`, 'Admin กดซ่อนรถ']);
          return {success: true, msg: 'ซ่อนรถคันนี้ออกจากหน้าเว็บเรียบร้อยแล้วครับ'};
        }
      }
    }
    return {success: false, msg: 'ไม่พบรหัสรถคันนี้ในระบบ'};
  } catch(e) { return {success: false, msg: e.message}; }
}

function saveBooking(form) {
  try {
    const ss = getSpreadsheet_();
    const bSheet = getSheetOrThrow_(ss, 'Bookings');
    const bData = bSheet.getDataRange().getValues();

    const newStart = parseTimeSafe_(form.start);
    const newEnd = parseTimeSafe_(form.end);
    if (!newStart || !newEnd || newStart >= newEnd) {
      return {success: false, msg: 'ช่วงเวลาเริ่ม/สิ้นสุดไม่ถูกต้อง'};
    }

    for(let i=1; i<bData.length; i++) {
        if(String(bData[i][1]).trim() === String(form.plate).trim() && String(bData[i][0]).trim() !== String(form.id).trim()) {
            
            // ✨ เพิ่มเช็คการคืนรถ: ถ้ากรอกเลขไมล์คืนรถแล้ว ไม่นับว่าซ้ำซ้อน
            const exEndMile = bData[i][11]; // ไมล์หลังใช้ (Index 11)
            if (exEndMile && parseFloat(exEndMile) > 0) continue;

            const exStart = parseTimeSafe_(bData[i][5]);
            const exEnd = parseTimeSafe_(bData[i][6]);
            if(newStart < exEnd && newEnd > exStart) {
                return {success: false, msg: 'มีการจองซ้ำซ้อน รถคันนี้ถูกจองในช่วงเวลานี้แล้วครับ'};
            }
        }
    }

    const logSheet = getSheetOrThrow_(ss, 'Logs');
    const vSheet = getSheetOrThrow_(ss, 'Vehicles');
    const nSheet = getSheetOrThrow_(ss, 'Name');
    const actionEmail = Session.getActiveUser().getEmail() || 'Unknown User';
    
    let nameParts = form.user.trim().split(' ');
    let fname = nameParts[0] || '';
    let lname = nameParts.slice(1).join(' ') || '';

    if (form.dept && form.dept.trim() !== '') {
      const nData = nSheet.getDataRange().getValues().map(r => r[2]);
      if (!nData.includes(form.dept)) nSheet.appendRow(['', '', form.dept]);
    }

    const vData = vSheet.getDataRange().getValues();
    for (let i = 1; i < vData.length; i++) {
      if (String(vData[i][1]).trim() === String(form.plate).trim()) { 
        if (form.endMile && parseFloat(form.endMile) > 0) vSheet.getRange(i + 1, 8).setValue(form.endMile); 
        if (form.parkingSpot && form.parkingSpot.trim() !== '') vSheet.getRange(i + 1, 9).setValue(form.parkingSpot); 
        break;
      }
    }

    if (form.id) {
      for (let i = 1; i < bData.length; i++) {
        if (String(bData[i][0]).trim() === String(form.id).trim()) {
          bSheet.getRange(i + 1, 2, 1, 12).setValues([[form.plate, fname, lname, form.dept, "'" + form.start, "'" + form.end, form.dest, form.driver, form.originalEmail, form.startMile, form.endMile, form.parkingSpot || '']]);
          clearAppCache_();
          logSheet.appendRow([new Date(), actionEmail, 'UPDATE_BOOKING', form.plate, `แก้ไข/คืนรถ (จุดจอด: ${form.parkingSpot || '-'}, ไมล์: ${form.startMile} -> ${form.endMile})`, form.editReason || '-']);
          return {success: true, msg: 'อัปเดตการจองและจุดจอดเรียบร้อยครับ'};
        }
      }
    } else {
      bSheet.appendRow(['B_' + new Date().getTime(), form.plate, fname, lname, form.dept, "'" + form.start, "'" + form.end, form.dest, form.driver, actionEmail, form.startMile, form.endMile, form.parkingSpot || '']);
      clearAppCache_();
      logSheet.appendRow([new Date(), actionEmail, 'CREATE_BOOKING', form.plate, `จองไป ${form.dest}`, '-']);
      return {success: true, msg: 'บันทึกการจองสำเร็จครับ'};
    }
  } catch (error) { return {success: false, msg: error.message}; }
}

function deleteBooking(id) {
  try {
    const ss = getSpreadsheet_();
    const bSheet = getSheetOrThrow_(ss, 'Bookings');
    const data = bSheet.getDataRange().getValues();
    const actionEmail = Session.getActiveUser().getEmail() || 'Unknown User';
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] == id) {
        const plate = data[i][1];
        const dest = data[i][7];
        bSheet.deleteRow(i + 1);
        clearAppCache_();
        getSheetOrThrow_(ss, 'Logs').appendRow([new Date(), actionEmail, 'DELETE_BOOKING', plate, `ลบการจองไป ${dest}`, 'ผู้ใช้กดยกเลิก/ลบการจอง']);
        return {success: true, msg: 'ลบข้อมูลการจองเรียบร้อยแล้วครับ'};
      }
    }
    return {success: false, msg: 'ไม่พบรหัสการจองนี้ในระบบ'};
  } catch(e) { return {success: false, msg: e.message}; }
}

function setupDailyTrigger() {
  ScriptApp.newTrigger('dailyExpiryCheck').timeBased().atHour(8).everyDays(1).create();
}

function dailyExpiryCheck() {
  const ss = getSpreadsheet_();
  const data = getSheetOrThrow_(ss, 'Vehicles').getDataRange().getValues();
  const now = new Date();
  
  let actAlerts = [];
  let leaseAlerts = [];

  for (let i = 1; i < data.length; i++) {
    let plate = data[i][1];
    let actExpiry = new Date(data[i][9]); // คอลัมน์ J (พ.ร.บ.)
    let leaseExpiry = new Date(data[i][12]); // คอลัมน์ M (หมดสัญญาเช่า)

    // เช็ค พ.ร.บ.
    if (actExpiry && !isNaN(actExpiry.getTime())) {
      let diffDays = (actExpiry - now) / (1000 * 60 * 60 * 24);
      if (diffDays >= 0 && diffDays <= 30) actAlerts.push(`- ทะเบียน ${plate} พ.ร.บ. จะหมดใน ${Math.ceil(diffDays)} วัน (${actExpiry.toLocaleDateString('th-TH')})`);
      else if (diffDays < 0) actAlerts.push(`- ทะเบียน ${plate} พ.ร.บ. หมดอายุแล้ว!`);
    }

    // เช็ค วันหมดสัญญาเช่า (วันคืนรถ)
    if (leaseExpiry && !isNaN(leaseExpiry.getTime())) {
      let diffDaysLease = (leaseExpiry - now) / (1000 * 60 * 60 * 24);
      if (diffDaysLease >= 0 && diffDaysLease <= 30) leaseAlerts.push(`- ทะเบียน ${plate} จะหมดสัญญาใน ${Math.ceil(diffDaysLease)} วัน (${leaseExpiry.toLocaleDateString('th-TH')})`);
      else if (diffDaysLease < 0) leaseAlerts.push(`- ทะเบียน ${plate} หมดสัญญาเช่าแล้ว!`);
    }
  }

  let emailBody = "";
  if (actAlerts.length > 0) emailBody += "⚠️ รายการ พ.ร.บ. ใกล้หมดอายุ / หมดอายุ:\n" + actAlerts.join("\n") + "\n\n";
  if (leaseAlerts.length > 0) emailBody += "⚠️ รายการ สัญญาเช่ารถใกล้หมด / ต้องคืนรถ:\n" + leaseAlerts.join("\n") + "\n\n";

  if (emailBody !== "") {
    MailApp.sendEmail({ 
      to: ADMIN_EMAIL, 
      subject: "⚠️ แจ้งเตือน พ.ร.บ. / สัญญาเช่ารถ (EMD CAR)", 
      body: "ระบบตรวจสอบพบรายการที่ต้องดำเนินการ ดังนี้:\n\n" + emailBody + "\nกรุณาดำเนินการเพื่อหลีกเลี่ยงปัญหาการใช้งานครับ" 
    });
  }
}
function quickUpdateMileage(id, plate, newMile) {
  try {
    const ss = getSpreadsheet_();
    const sheet = getSheetOrThrow_(ss, 'Vehicles');
    const data = sheet.getDataRange().getValues();
    const actionEmail = Session.getActiveUser().getEmail() || 'Unknown User';
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] == id) {
        sheet.getRange(i + 1, 8).setValue(newMile); 
        clearAppCache_();
        getSheetOrThrow_(ss, 'Logs').appendRow([new Date(), actionEmail, 'UPDATE_MILEAGE', plate, `แก้ไขไมล์ด่วน: ${newMile} km`, 'แก้เลขไมล์ที่กรอกผิด']);
        return { success: true, msg: 'อัปเดตเลขไมล์เรียบร้อยครับ' };
      }
    }
    return { success: false, msg: 'ไม่พบรถในระบบ' };
  } catch(e) { return { success: false, msg: e.message }; }
}