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
const EMD_SESSION_CACHE_PREFIX = 'EMD_SESSION_';
const COMPANY_SESSION_CACHE_PREFIX = 'COMPANY_SESSION_';
const LINE_REMINDER_CACHE_PREFIX = 'LINE_REMINDER_';
const LINE_MESSAGE_FOOTER = '\n\nสามารถดูตารางการใช้รถทั้งหมดได้ ที่ https://pongvitsam.github.io/EMD_CAR/\nlog in ด้วยรหัส TC และกรุณานำรถมาส่งก่อนถึงเวลาอย่างน้อย 3 ชั่วโมง';
const EMD_ACCESS_CODE = 'emd2';
const COMPANY_USERNAME = 'tc';
const SESSION_TTL_SEC = 21600;
const VEHICLE_HEADERS = ['Vehicle_ID', 'ทะเบียน', 'รูปรถ(URL)', 'ประเภท', 'Email', 'Password', 'ระยะ Service (km)', 'ไมล์ล่าสุด (km)', 'จุดจอดล่าสุด', 'พรบ.หมดอายุ', 'หมายเหตุ', 'สถานะ', 'วันคืนรถ/หมดสัญญา', 'วันที่เช็คระยะล่าสุด', 'กม.เช็คระยะล่าสุด', 'ผู้นำเข้าเช็คระยะ', 'ระยะกม.ต่อรอบ', 'ประวัติเช็คระยะ(JSON)', 'แผนรอบถัดไป(JSON)', 'หมายเหตุบำรุงรักษา', 'ManagedBy', 'VehicleGroup'];
const DEFAULT_VEHICLE_GROUP_ALL = 'ALL';
const VEHICLE_GROUP_HEADERS = ['Group_ID', 'ชื่อกลุ่ม', 'คำค้นงาน(JSON)', 'ลำดับ', 'ระบบ'];
const DEFAULT_SERVICE_INTERVAL_KM = 10000;

function getSpreadsheet_() {
  return SpreadsheetApp.openById(SHEET_ID);
}

function getSheetOrThrow_(ss, sheetName) {
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) throw new Error('ไม่พบชีต: ' + sheetName);
  return sheet;
}

function parseLocalDateTimeSafe_(val) {
  const clean = String(val || '').trim().replace('T', ' ').replace(/-/g, '/');
  const match = clean.match(/^(\d{1,4})\/(\d{1,2})\/(\d{1,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!match) return 0;

  const first = match[1];
  let year;
  let month;
  let day;
  if (first.length === 4) {
    year = parseInt(match[1], 10);
    month = parseInt(match[2], 10);
    day = parseInt(match[3], 10);
  } else {
    day = parseInt(match[1], 10);
    month = parseInt(match[2], 10);
    year = parseInt(match[3], 10);
  }
  if (year >= 2400) year -= 543;

  const hour = parseInt(match[4] || '0', 10);
  const minute = parseInt(match[5] || '0', 10);
  const second = parseInt(match[6] || '0', 10);
  const d = new Date(year, month - 1, day, hour, minute, second);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return 0;
  return d.getTime();
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
  const localTime = parseLocalDateTimeSafe_(s);
  if (localTime) return localTime;
  let clean = s.replace('T', ' ').replace(/-/g, '/');
  if (clean.length === 16) clean += ':00';
  const d = new Date(clean);
  if (!isNaN(d.getTime())) return d.getTime();
  const fallback = new Date(s);
  return isNaN(fallback.getTime()) ? 0 : fallback.getTime();
}

function hasInputValue_(value) {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

function parseMileageNumberStrict_(value) {
  if (!hasInputValue_(value)) return null;
  const raw = String(value).trim();
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(raw)) return null;
  const text = raw.replace(/,/g, '');
  if (!/^\d+(\.\d+)?$/.test(text)) return null;
  const n = Number(text);
  return isFinite(n) ? n : null;
}

function normalizePlateKey_(value) {
  return String(value || '').trim().toUpperCase().replace(/[^0-9A-Z\u0E00-\u0E7F]/g, '');
}

function validateBookingMileage_(form, bData, newStart, newEnd) {
  const hasStart = hasInputValue_(form.startMile);
  const hasEnd = hasInputValue_(form.endMile);
  const startMile = parseMileageNumberStrict_(form.startMile);
  const endMile = parseMileageNumberStrict_(form.endMile);

  if (hasStart && (startMile === null || startMile <= 0)) {
    return { success: false, msg: 'ไมล์ก่อนใช้ต้องเป็นตัวเลขมากกว่า 0' };
  }
  if (hasEnd && (endMile === null || endMile <= 0)) {
    return { success: false, msg: 'ไมล์หลังใช้ต้องเป็นตัวเลขมากกว่า 0' };
  }
  if (startMile !== null && endMile !== null && startMile > endMile) {
    return { success: false, msg: 'ไมล์ก่อนใช้ต้องไม่มากกว่าไมล์หลังใช้' };
  }

  const plateKey = normalizePlateKey_(form.plate);
  const formId = String(form.id || '').trim();
  const candidates = [];
  if (startMile !== null) candidates.push({ label: 'ไมล์ก่อนใช้', value: startMile });
  if (endMile !== null) candidates.push({ label: 'ไมล์หลังใช้', value: endMile });

  if (plateKey && candidates.length) {
    for (let i = 1; i < bData.length; i++) {
      if (String(bData[i][0]).trim() === formId) continue;
      if (normalizePlateKey_(bData[i][1]) !== plateKey) continue;

      const exStart = parseTimeSafe_(bData[i][5]);
      const exEnd = parseTimeSafe_(bData[i][6]);
      if (!exStart || !exEnd || !(newStart < exEnd && newEnd > exStart)) continue;

      const existing = [
        { label: 'ไมล์ก่อนใช้', value: parseMileageNumberStrict_(bData[i][10]) },
        { label: 'ไมล์หลังใช้', value: parseMileageNumberStrict_(bData[i][11]) }
      ].filter(row => row.value !== null);

      for (const candidate of candidates) {
        const matched = existing.find(row => row.value === candidate.value);
        if (matched) {
          const userName = String((bData[i][2] || '') + ' ' + (bData[i][3] || '')).trim() || 'ผู้ใช้งานก่อนหน้า';
          return {
            success: false,
            msg: `${candidate.label} ${candidate.value.toLocaleString('th-TH')} ซ้ำกับ${matched.label}ของ ${userName} ในช่วงเวลาใช้งานเดียวกัน`
          };
        }
      }
    }
  }

  return {
    success: true,
    startMile: startMile === null ? '' : startMile,
    endMile: endMile === null ? '' : endMile
  };
}

function clearAppCache_() {
  const cache = CacheService.getScriptCache();
  cache.remove(APP_DATA_CACHE_KEY);
  cache.remove(APP_DATA_CORE_CACHE_KEY);
  cache.remove(APP_LOGS_CACHE_KEY);
  cache.remove(LEGACY_APP_DATA_CACHE_KEY);
}

function putCacheSafe_(cache, key, value, ttlSec) {
  try {
    const text = String(value || '');
    if (text.length > 90000) return false;
    cache.put(key, text, ttlSec);
    return true;
  } catch (err) {
    return false;
  }
}

function createAdminSession_() {
  const token = Utilities.getUuid();
  CacheService.getScriptCache().put(ADMIN_SESSION_CACHE_PREFIX + token, '1', SESSION_TTL_SEC);
  return token;
}

function createEmdSession_() {
  const token = Utilities.getUuid();
  CacheService.getScriptCache().put(EMD_SESSION_CACHE_PREFIX + token, '1', SESSION_TTL_SEC);
  return token;
}

function createCompanySession_() {
  const token = Utilities.getUuid();
  CacheService.getScriptCache().put(COMPANY_SESSION_CACHE_PREFIX + token, '1', SESSION_TTL_SEC);
  return token;
}

function resolveSessionRole_(token) {
  if (!token) return null;
  const cache = CacheService.getScriptCache();
  if (cache.get(ADMIN_SESSION_CACHE_PREFIX + token) === '1') return 'ADMIN';
  if (cache.get(EMD_SESSION_CACHE_PREFIX + token) === '1') return 'EMD';
  if (cache.get(COMPANY_SESSION_CACHE_PREFIX + token) === '1') return 'COMPANY';
  return null;
}

function refreshSession_(token, role) {
  if (!token || !role) return;
  const cache = CacheService.getScriptCache();
  const prefix = role === 'ADMIN' ? ADMIN_SESSION_CACHE_PREFIX
    : role === 'EMD' ? EMD_SESSION_CACHE_PREFIX
    : COMPANY_SESSION_CACHE_PREFIX;
  cache.put(prefix + token, '1', SESSION_TTL_SEC);
}

function requireAdminSession_(token) {
  if (resolveSessionRole_(token) !== 'ADMIN') {
    throw new Error('กรุณาเข้าสู่ระบบ Admin อีกครั้ง');
  }
  refreshSession_(token, 'ADMIN');
}

function requireMutationAccess_(token) {
  const role = resolveSessionRole_(token);
  if (role === 'EMD' || role === 'ADMIN') {
    refreshSession_(token, role);
    return role;
  }
  if (role === 'COMPANY') throw new Error('บริษัทมีสิทธิ์ดูข้อมูลอย่างเดียว');
  throw new Error('กรุณาเข้าสู่ระบบก่อนดำเนินการ');
}

function requireAppSession_(token) {
  const role = resolveSessionRole_(token);
  if (!role) throw new Error('กรุณาเข้าสู่ระบบ');
  refreshSession_(token, role);
  return role;
}

function filterHiddenVehiclesFromPayload_(payload) {
  const vehicles = (payload.vehicles || []).filter(function (v) {
    return String(v.status || '') !== 'HIDDEN';
  });
  const visiblePlates = {};
  vehicles.forEach(function (v) {
    visiblePlates[normalizePlateKey_(v.plate)] = true;
  });
  const bookings = (payload.bookings || []).filter(function (b) {
    return visiblePlates[normalizePlateKey_(b.plate)];
  });
  return Object.assign({}, payload, { vehicles: vehicles, bookings: bookings });
}

function filterPayloadForCompany_(payload) {
  const vehicles = (payload.vehicles || []).filter(function (v) {
    if (String(v.status || '') === 'HIDDEN') return false;
    if (String(v.managedBy || '').toUpperCase() !== 'COMPANY') return false;
    return normalizeVehicleGroupId_(v.vehicleGroup) !== DEFAULT_VEHICLE_GROUP_ALL;
  }).map(function (v) {
    return {
      id: v.id,
      plate: v.plate,
      img: v.img,
      type: v.type,
      parkingSpot: v.parkingSpot,
      remarks: v.remarks,
      status: v.status,
      managedBy: v.managedBy,
      vehicleGroup: v.vehicleGroup,
      currentMile: parseFloat(v.currentMile) || 0,
      serviceMile: parseFloat(v.serviceMile) || 0,
      actExpiry: v.actExpiry,
      serviceIntervalKm: parseFloat(v.serviceIntervalKm) || 0,
      serviceLastKm: parseFloat(v.serviceLastKm) || 0
    };
  });
  const companyPlates = {};
  vehicles.forEach(function (v) {
    companyPlates[normalizePlateKey_(v.plate)] = true;
  });
  const bookings = (payload.bookings || []).filter(function (b) {
    return companyPlates[normalizePlateKey_(b.plate)];
  });
  const companyGroupIds = {};
  vehicles.forEach(function (v) {
    const groupId = normalizeVehicleGroupId_(v.vehicleGroup);
    if (groupId && groupId !== DEFAULT_VEHICLE_GROUP_ALL) companyGroupIds[groupId] = true;
  });
  const vehicleGroups = (payload.vehicleGroups || []).filter(function (g) {
    return g.id !== DEFAULT_VEHICLE_GROUP_ALL && companyGroupIds[g.id];
  });
  return {
    vehicles: vehicles,
    bookings: bookings,
    names: [],
    logs: [],
    settings: {
      bannerStatus: payload.settings && payload.settings.bannerStatus,
      bannerText: payload.settings && payload.settings.bannerText,
      mileageReminderExempt: []
    },
    vehicleGroups: vehicleGroups
  };
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
  const managedHeader = sheet.getRange(1, 21).getValue();
  if (String(managedHeader || '').trim() !== 'ManagedBy') {
    sheet.getRange(1, 21).setValue('ManagedBy');
  }
  const groupHeader = sheet.getRange(1, 22).getValue();
  if (String(groupHeader || '').trim() !== 'VehicleGroup') {
    sheet.getRange(1, 22).setValue('VehicleGroup');
  }
  return sheet;
}

function ensureVehicleGroupsSheet_(ss) {
  let sheet = ss.getSheetByName('VehicleGroups');
  if (!sheet) {
    sheet = ss.insertSheet('VehicleGroups');
    sheet.appendRow(VEHICLE_GROUP_HEADERS);
    sheet.appendRow([DEFAULT_VEHICLE_GROUP_ALL, 'รถที่จองใช้ได้ทุกงาน', '[]', 1, 'YES']);
    sheet.appendRow(['pwa', 'รถเฉพาะงานการประปา', '["การประปา","ประปา","กปน","กปน."]', 2, '']);
    return sheet;
  }
  const headers = sheet.getRange(1, 1, 1, VEHICLE_GROUP_HEADERS.length).getValues()[0];
  VEHICLE_GROUP_HEADERS.forEach(function (h, idx) {
    if (!headers[idx]) sheet.getRange(1, idx + 1).setValue(h);
  });
  if (sheet.getLastRow() < 2) {
    sheet.appendRow([DEFAULT_VEHICLE_GROUP_ALL, 'รถที่จองใช้ได้ทุกงาน', '[]', 1, 'YES']);
    sheet.appendRow(['pwa', 'รถเฉพาะงานการประปา', '["การประปา","ประปา","กปน","กปน."]', 2, '']);
  }
  return sheet;
}

function parseGroupKeywords_(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map(function (k) { return String(k || '').trim(); }).filter(Boolean);
  }
  try {
    const parsed = JSON.parse(String(value));
    if (!Array.isArray(parsed)) return [];
    return parsed.map(function (k) { return String(k || '').trim(); }).filter(Boolean);
  } catch (err) {
    return String(value).split(',').map(function (k) { return k.trim(); }).filter(Boolean);
  }
}

function normalizeVehicleGroupId_(value) {
  const id = String(value || DEFAULT_VEHICLE_GROUP_ALL).trim();
  return id || DEFAULT_VEHICLE_GROUP_ALL;
}

function getVehicleGroups_() {
  const ss = getSpreadsheet_();
  setupDatabase();
  const sheet = getSheetOrThrow_(ss, 'VehicleGroups');
  const data = sheet.getDataRange().getValues();
  return data.slice(1).map(function (r, idx) {
    return {
      row: idx + 2,
      id: normalizeVehicleGroupId_(r[0]),
      name: String(r[1] || '').trim() || normalizeVehicleGroupId_(r[0]),
      keywords: parseGroupKeywords_(r[2]),
      sortOrder: parseInt(r[3], 10) || 999,
      isSystem: String(r[4] || '').trim().toUpperCase() === 'YES'
    };
  }).filter(function (g) { return g.id; }).sort(function (a, b) {
    return a.sortOrder - b.sortOrder || String(a.name).localeCompare(String(b.name), 'th');
  });
}

function getVehicleGroupById_(groupId) {
  const id = normalizeVehicleGroupId_(groupId);
  const groups = getVehicleGroups_();
  return groups.find(function (g) { return g.id === id; }) || null;
}

function matchesGroupKeywords_(dept, dest, keywords) {
  const keys = (keywords || []).map(function (k) { return String(k || '').trim().toLowerCase(); }).filter(Boolean);
  if (!keys.length) return false;
  const haystack = (String(dept || '') + ' ' + String(dest || '')).toLowerCase();
  return keys.some(function (k) { return haystack.indexOf(k) >= 0; });
}

function isVehicleBookableForContext_(vehicleGroupId, dept, dest) {
  const groupId = normalizeVehicleGroupId_(vehicleGroupId);
  if (groupId === DEFAULT_VEHICLE_GROUP_ALL) return true;
  const group = getVehicleGroupById_(groupId);
  if (!group) return false;
  return matchesGroupKeywords_(dept, dest, group.keywords);
}

function ensureBookingsPhoneColumn_(ss) {
  const sheet = ss.getSheetByName('Bookings');
  if (!sheet) return;
  const header = sheet.getRange(1, 14).getValue();
  if (String(header || '').trim() !== 'เบอร์ติดต่อ') {
    sheet.getRange(1, 14).setValue('เบอร์ติดต่อ');
  }
}

function normalizeContactPhone_(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length < 9 || digits.length > 15) return '';
  return digits;
}

function getVehicleGroupIdByPlate_(plate) {
  const ss = getSpreadsheet_();
  const vData = getSheetOrThrow_(ss, 'Vehicles').getDataRange().getValues();
  for (let i = 1; i < vData.length; i++) {
    if (normalizePlateKey_(vData[i][1]) === normalizePlateKey_(plate)) {
      return normalizeVehicleGroupId_(vData[i][21]);
    }
  }
  return DEFAULT_VEHICLE_GROUP_ALL;
}

function requiresBookingPhone_(plate) {
  return getVehicleGroupIdByPlate_(plate) !== DEFAULT_VEHICLE_GROUP_ALL;
}

function validateBookingPhone_(plate, phone) {
  if (!requiresBookingPhone_(plate)) {
    return { success: true, phone: normalizeContactPhone_(phone) };
  }
  const normalized = normalizeContactPhone_(phone);
  if (!normalized) {
    return { success: false, msg: 'กรุณาระบุเบอร์โทรติดต่อสำหรับรถงานเฉพาะ (บริษัทใช้ติดต่อตอนส่งรถ)' };
  }
  return { success: true, phone: normalized };
}

function validateVehicleGroupBooking_(plate, dept, dest) {
  return { success: true };
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

function vehicleMaintenanceRemarksField_(form, row) {
  if (form && Object.prototype.hasOwnProperty.call(form, 'maintenanceRemarks')) {
    return String(form.maintenanceRemarks || '');
  }
  if (row && row[19] !== undefined && row[19] !== null) return String(row[19]);
  return '';
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
  const managedBy = String(vehicleFormField_(form, 'managedBy', row, 20, 'EMD') || 'EMD').trim().toUpperCase() === 'COMPANY' ? 'COMPANY' : 'EMD';
  const vehicleGroup = normalizeVehicleGroupId_(vehicleFormField_(form, 'vehicleGroup', row, 21, DEFAULT_VEHICLE_GROUP_ALL));
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
    roundPlanJson,
    vehicleMaintenanceRemarksField_(form, row),
    managedBy,
    vehicleGroup
  ];
}

function include_(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
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
      return jsonOutput_(dispatchApi_(params.action, args, params.token || '', params.clientIp || ''));
    } catch (err) {
      return jsonOutput_({ success: false, msg: String(err.message || err) });
    }
  }
  return HtmlService.createTemplateFromFile('Index')
      .evaluate()
      .setTitle('🚗 EMD CAR 🚗')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const action = body.action;
    if (!action) return jsonOutput_({ success: false, msg: 'ไม่ระบุ action' });
    const args = Array.isArray(body.args) ? body.args : [];
    const result = dispatchApi_(action, args, body.token || '', body.clientIp || '');
    return jsonOutput_(result);
  } catch (err) {
    return jsonOutput_({ success: false, msg: String(err.message || err) });
  }
}

function jsonOutput_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
      .setMimeType(ContentService.MimeType.JSON);
}

function sanitizeClientIp_(ip) {
  const s = String(ip || '').trim();
  if (!s || s.length > 45) return '-';
  if (!/^[\d.a-fA-F:]+$/.test(s)) return '-';
  return s;
}

function resolveClientIp_(clientIp, payload) {
  const fromPayload = payload && payload.clientIp ? String(payload.clientIp).trim() : '';
  const ip = fromPayload || String(clientIp || '').trim();
  return sanitizeClientIp_(ip);
}

function ensureLogsIpColumn_(ss) {
  const sheet = ss.getSheetByName('Logs');
  if (!sheet) return;
  const header = sheet.getRange(1, 7).getValue();
  if (String(header || '').trim() !== 'IP') {
    sheet.getRange(1, 7).setValue('IP');
  }
}

function appendLogRow_(logSheet, email, action, target, detail, reason, clientIp) {
  logSheet.appendRow([
    new Date(),
    email,
    action,
    target,
    detail,
    reason || '-',
    clientIp || '-'
  ]);
}

function dispatchApi_(action, args, token, clientIp) {
  args = Array.isArray(args) ? args : [];
  switch (action) {
    case 'getAppData': return getAppData(!(args.length > 0 && args[0] === false), token);
    case 'getAppLogs': return getAppLogs_(token);
    case 'verifyAdminLogin': return verifyAdminLogin(args[0], args[1]);
    case 'verifyEmdLogin': return verifyEmdLogin(args[0]);
    case 'verifyCompanyLogin': return verifyCompanyLogin(args[0], args[1]);
    case 'checkAdminSession': return checkAdminSession(args[0] || token);
    case 'checkEmdSession': return checkEmdSession(args[0] || token);
    case 'checkCompanySession': return checkCompanySession(args[0] || token);
    case 'saveAdminSettings': return saveAdminSettings(args[0], token);
    case 'getNameManagementData': return getNameManagementData(token);
    case 'saveManagedName': return saveManagedName(token, args[0]);
    case 'deleteManagedName': return deleteManagedName(token, args[0]);
    case 'saveNameOption': return saveNameOption(args[0], token);
    case 'saveVehicle': return saveVehicle(args[0], clientIp, token);
    case 'saveVehicleManagement': return saveVehicleManagement(token, args[0], clientIp);
    case 'deleteVehicle': return deleteVehicle(args[0], args[1], clientIp, token);
    case 'saveBooking': return saveBooking(args[0], clientIp, token);
    case 'deleteBooking': return deleteBooking(args[0], args[1], clientIp, token);
    case 'quickUpdateMileage': return quickUpdateMileage(args[0], args[1], args[2], clientIp, token);
    case 'getVehicleGroupManagementData': return getVehicleGroupManagementData(token);
    case 'saveVehicleGroup': return saveVehicleGroup(token, args[0]);
    case 'deleteVehicleGroup': return deleteVehicleGroup(token, args[0]);
    case 'testLineUpcomingSummary': return testLineUpcomingSummary(token, args[0]);
    default: throw new Error('Unknown action: ' + action);
  }
}

function setupDatabase() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  if (!ss.getSheetByName('Name')) ss.insertSheet('Name').appendRow(['ชื่อ', 'นามสกุล', 'แผนก']);
  ensureVehiclesSheet_(ss);
  ensureVehicleGroupsSheet_(ss);
  if (!ss.getSheetByName('Bookings')) ss.insertSheet('Bookings').appendRow(['Booking_ID', 'ทะเบียนรถ', 'ชื่อ', 'นามสกุล', 'แผนก', 'เริ่ม', 'สิ้นสุด', 'จุดหมาย', 'ผู้ขับขี่', 'อีเมลผู้บันทึก', 'ไมล์ก่อนใช้', 'ไมล์หลังใช้', 'จุดจอดหลังใช้งาน', 'เบอร์ติดต่อ']);
  ensureBookingsPhoneColumn_(ss);
  if (!ss.getSheetByName('Logs')) ss.insertSheet('Logs').appendRow(['Timestamp', 'อีเมลผู้ทำรายการ', 'Action', 'Target', 'รายละเอียด', 'เหตุผลการแก้ไข', 'IP']);
  ensureLogsIpColumn_(ss);
  
  if (!ss.getSheetByName('Settings')) {
    const sSheet = ss.insertSheet('Settings');
    sSheet.appendRow(['Key', 'Value', 'Description']);
    sSheet.appendRow(['AdminUser', 'admin', 'ชื่อผู้ใช้สำหรับ Admin']);
    sSheet.appendRow(['AdminPass', '03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4', 'รหัสผ่าน Admin (Hash SHA-256)']);
    sSheet.appendRow(['BannerStatus', 'ON', 'สถานะ Banner (ON/OFF)']);
    sSheet.appendRow(['BannerText', 'ยินดีต้อนรับสู่ระบบจองรถ EMD CAR!', 'ข้อความแจ้งเตือนที่แสดงวิ่งด้านบน']);
    sSheet.appendRow(['MileageReminderExempt', '[]', 'รายชื่อยกเว้นแจ้งเตือนไมล์ (JSON array)']);
    sSheet.appendRow(['LineChannelAccessToken', '', 'LINE Messaging API Channel Access Token']);
    sSheet.appendRow(['LineGroupId', '', 'LINE Group ID สำหรับแจ้งเตือน']);
    sSheet.appendRow(['LineReminderMinutes', '180', 'เตือนก่อนเวลาส่งรถ (นาที)']);
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
    serviceRoundPlan: parseVehicleServiceRoundPlan_(r[18]),
    maintenanceRemarks: r[19] || '',
    managedBy: String(r[20] || 'EMD').trim().toUpperCase() === 'COMPANY' ? 'COMPANY' : 'EMD',
    vehicleGroup: normalizeVehicleGroupId_(r[21])
  }));

  const vehicleGroups = getVehicleGroups_();

  const bDataVal = getSheetOrThrow_(ss, 'Bookings').getDataRange().getValues();
  const bookings = bDataVal.slice(1).map(r => ({
    id: r[0], plate: r[1], name: r[2], surname: r[3],
    dept: r[4], start: r[5], end: r[6], dest: r[7], driver: r[8],
    userEmail: r[9], startMile: r[10], endMile: r[11], parkingSpot: r[12] || '',
    contactPhone: r[13] || ''
  }));

  const nData = getSheetOrThrow_(ss, 'Name').getDataRange().getValues();
  const names = nData.slice(1).map(r => ({ fullName: (r[0] || '') + ' ' + (r[1] || ''), dept: r[2] || '' }));

  let logs = [];
  if (includeLogs) logs = readLogsFromSheet_(ss);

  const sData = getSheetOrThrow_(ss, 'Settings').getDataRange().getValues();
  let settings = { bannerStatus: 'OFF', bannerText: '', mileageReminderExempt: [], lineChannelAccessToken: '', lineGroupId: '', lineReminderMinutes: 180 };
  for (let i = 1; i < sData.length; i++) {
    if (sData[i][0] === 'BannerStatus') settings.bannerStatus = sData[i][1];
    if (sData[i][0] === 'BannerText') settings.bannerText = sData[i][1];
    if (sData[i][0] === 'MileageReminderExempt') settings.mileageReminderExempt = parseMileageReminderExempt_(sData[i][1]);
    if (sData[i][0] === 'LineChannelAccessToken') settings.lineChannelAccessToken = String(sData[i][1] || '');
    if (sData[i][0] === 'LineGroupId') settings.lineGroupId = String(sData[i][1] || '');
    if (sData[i][0] === 'LineReminderMinutes') settings.lineReminderMinutes = parseInt(sData[i][1], 10) || 180;
  }

  return { vehicles, bookings, names, logs, settings, vehicleGroups };
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
    timestamp: r[0], email: r[1], action: r[2], target: r[3], detail: r[4], reason: r[5] || '-', ip: r[6] || '-'
  })).reverse();
}

function getAppData(includeLogs, token) {
  const role = resolveSessionRole_(token);
  if (!role) {
    return { success: false, requiresAuth: true, msg: 'กรุณาเข้าสู่ระบบ' };
  }
  refreshSession_(token, role);

  const wantLogs = (includeLogs !== false) && role === 'ADMIN';
  const cache = CacheService.getScriptCache();
  const cacheKey = wantLogs ? APP_DATA_CACHE_KEY : APP_DATA_CORE_CACHE_KEY;
  let normalized;
  const cachedPayload = cache.get(cacheKey);
  if (cachedPayload) {
    normalized = JSON.parse(cachedPayload);
  } else {
    const ss = getSpreadsheet_();
    setupDatabase();
    normalized = JSON.parse(JSON.stringify(buildAppPayload_(ss, wantLogs)));
    putCacheSafe_(cache, cacheKey, JSON.stringify(normalized), CACHE_TTL_SEC);
    if (wantLogs) {
      const coreOnly = Object.assign({}, normalized, { logs: [] });
      putCacheSafe_(cache, APP_DATA_CORE_CACHE_KEY, JSON.stringify(coreOnly), CACHE_TTL_SEC);
    }
  }

  let payload = attachCurrentUser_(normalized);
  payload.role = role;
  payload.readOnly = role === 'COMPANY';
  payload.success = true;

  if (role === 'COMPANY') {
    payload = attachCurrentUser_(filterPayloadForCompany_(payload));
    payload.role = 'COMPANY';
    payload.readOnly = true;
    payload.logs = [];
  } else if (role === 'EMD') {
    payload = attachCurrentUser_(filterHiddenVehiclesFromPayload_(payload));
    payload.role = 'EMD';
    payload.logs = [];
  } else if (role !== 'ADMIN') {
    payload.logs = [];
  }

  return payload;
}

function getAppLogs_(token) {
  try {
    requireAdminSession_(token);
  } catch (error) {
    return { success: false, msg: error.message };
  }
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
  
  if(user === savedUser && txtHash === savedHash) {
    return { success: true, token: createAdminSession_(), role: 'ADMIN' };
  }
  return { success: false, msg: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' };
}

function verifyEmdLogin(accessCode) {
  if (String(accessCode || 'emd2').trim().toLowerCase() === EMD_ACCESS_CODE) {
    return { success: true, token: createEmdSession_(), role: 'EMD' };
  }
  return { success: false, msg: 'รหัสเข้าใช้งานไม่ถูกต้อง' };
}

function verifyCompanyLogin(user, passText) {
  if (String(user || '').trim().toLowerCase() === COMPANY_USERNAME) {
    return { success: true, token: createCompanySession_(), role: 'COMPANY' };
  }
  return { success: false, msg: 'ชื่อผู้ใช้ไม่ถูกต้อง' };
}

function checkAdminSession(token) {
  try {
    requireAdminSession_(token);
    return { success: true, token: token, role: 'ADMIN' };
  } catch (error) {
    return { success: false, msg: error.message };
  }
}

function checkEmdSession(token) {
  if (resolveSessionRole_(token) === 'EMD') {
    refreshSession_(token, 'EMD');
    return { success: true, token: token, role: 'EMD' };
  }
  return { success: false, msg: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่' };
}

function checkCompanySession(token) {
  if (resolveSessionRole_(token) === 'COMPANY') {
    refreshSession_(token, 'COMPANY');
    return { success: true, token: token, role: 'COMPANY' };
  }
  return { success: false, msg: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่' };
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

function getVehicleGroupManagementData(token) {
  try {
    requireAdminSession_(token);
    return { success: true, groups: getVehicleGroups_() };
  } catch (error) { return { success: false, msg: error.message }; }
}

function saveVehicleGroup(token, form) {
  try {
    requireAdminSession_(token);
    const ss = getSpreadsheet_();
    setupDatabase();
    const sheet = getSheetOrThrow_(ss, 'VehicleGroups');
    const name = String(form.name || '').trim();
    let id = String(form.id || '').trim();
    const row = Number(form.row) || 0;
    const keywords = parseGroupKeywords_(form.keywords);
    const sortOrder = parseInt(form.sortOrder, 10) || 999;
    if (!name) return { success: false, msg: 'กรุณาระบุชื่อกลุ่ม' };
    if (!id) {
      id = 'grp_' + new Date().getTime();
    }
    if (id === DEFAULT_VEHICLE_GROUP_ALL) {
      return { success: false, msg: 'ไม่สามารถแก้ไขกลุ่มระบบ ALL ได้' };
    }
    const groups = getVehicleGroups_();
    const duplicate = groups.some(function (g) {
      return g.row !== row && g.id === id;
    });
    if (duplicate) return { success: false, msg: 'รหัสกลุ่มซ้ำ' };
    const values = [id, name, JSON.stringify(keywords), sortOrder, ''];
    if (row >= 2 && row <= sheet.getLastRow()) {
      const existingId = String(sheet.getRange(row, 1).getValue() || '').trim();
      if (existingId === DEFAULT_VEHICLE_GROUP_ALL) {
        return { success: false, msg: 'ไม่สามารถแก้ไขกลุ่มระบบ ALL ได้' };
      }
      sheet.getRange(row, 1, 1, values.length).setValues([values]);
    } else {
      sheet.appendRow(values);
    }
    clearAppCache_();
    return { success: true, msg: 'บันทึกกลุ่มรถเรียบร้อยครับ', groups: getVehicleGroups_() };
  } catch (error) { return { success: false, msg: error.message }; }
}

function deleteVehicleGroup(token, rowOrId) {
  try {
    requireAdminSession_(token);
    const ss = getSpreadsheet_();
    setupDatabase();
    const sheet = getSheetOrThrow_(ss, 'VehicleGroups');
    const vSheet = getSheetOrThrow_(ss, 'Vehicles');
    let targetRow = Number(rowOrId) || 0;
    let groupId = '';
    if (!targetRow) {
      const groups = getVehicleGroups_();
      const found = groups.find(function (g) { return g.id === String(rowOrId || '').trim(); });
      if (found) {
        targetRow = found.row;
        groupId = found.id;
      }
    } else {
      groupId = String(sheet.getRange(targetRow, 1).getValue() || '').trim();
    }
    if (targetRow < 2 || targetRow > sheet.getLastRow()) {
      return { success: false, msg: 'ไม่พบกลุ่มที่ต้องการลบ' };
    }
    if (groupId === DEFAULT_VEHICLE_GROUP_ALL) {
      return { success: false, msg: 'ไม่สามารถลบกลุ่ม "ทุกงาน" ได้' };
    }
    const vData = vSheet.getDataRange().getValues();
    for (let i = 1; i < vData.length; i++) {
      if (normalizeVehicleGroupId_(vData[i][21]) === groupId) {
        vSheet.getRange(i + 1, 22).setValue(DEFAULT_VEHICLE_GROUP_ALL);
      }
    }
    sheet.deleteRow(targetRow);
    clearAppCache_();
    return { success: true, msg: 'ลบกลุ่มและย้ายรถกลับเป็น "ทุกงาน" แล้ว', groups: getVehicleGroups_() };
  } catch (error) { return { success: false, msg: error.message }; }
}

function saveAdminSettings(form, token) {
  try {
    requireAdminSession_(token);
    const ss = getSpreadsheet_();
    const sheet = getSheetOrThrow_(ss, 'Settings');
    const data = sheet.getDataRange().getValues();
    
    let updatedStatus = false, updatedText = false, updatedExempt = false;
    let updatedLineToken = false, updatedLineGroup = false, updatedLineReminder = false;
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
      if (form.lineChannelAccessToken !== undefined && data[i][0] === 'LineChannelAccessToken') {
        sheet.getRange(i + 1, 2).setValue(String(form.lineChannelAccessToken || ''));
        updatedLineToken = true;
      }
      if (form.lineGroupId !== undefined && data[i][0] === 'LineGroupId') {
        sheet.getRange(i + 1, 2).setValue(String(form.lineGroupId || ''));
        updatedLineGroup = true;
      }
      if (form.lineReminderMinutes !== undefined && data[i][0] === 'LineReminderMinutes') {
        sheet.getRange(i + 1, 2).setValue(String(form.lineReminderMinutes || '180'));
        updatedLineReminder = true;
      }
    }
    
    if(!updatedStatus) sheet.appendRow(['BannerStatus', form.status]);
    if(!updatedText) sheet.appendRow(['BannerText', form.text]);
    if (exemptJson !== null && !updatedExempt) sheet.appendRow(['MileageReminderExempt', exemptJson]);
    if (form.lineChannelAccessToken !== undefined && !updatedLineToken) {
      sheet.appendRow(['LineChannelAccessToken', String(form.lineChannelAccessToken || '')]);
    }
    if (form.lineGroupId !== undefined && !updatedLineGroup) {
      sheet.appendRow(['LineGroupId', String(form.lineGroupId || '')]);
    }
    if (form.lineReminderMinutes !== undefined && !updatedLineReminder) {
      sheet.appendRow(['LineReminderMinutes', String(form.lineReminderMinutes || '180')]);
    }
    clearAppCache_();
    
    return { success: true, msg: 'บันทึกการตั้งค่าระบบเรียบร้อยครับ' };
  } catch (error) { return { success: false, msg: error.message }; }
}

function saveNameOption(form, token) {
  try {
    requireMutationAccess_(token);
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

function saveVehicleManagement(token, form, clientIp) {
  requireAdminSession_(token);
  return saveVehicle(form, clientIp);
}

function saveVehicle(form, clientIp, token) {
  try {
    requireMutationAccess_(token);
    const ss = getSpreadsheet_();
    setupDatabase();
    const sheet = getSheetOrThrow_(ss, 'Vehicles');
    const logSheet = getSheetOrThrow_(ss, 'Logs');
    const actionEmail = Session.getActiveUser().getEmail() || 'Unknown User';
    const ip = resolveClientIp_(clientIp, form);
    
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
          appendLogRow_(logSheet, actionEmail, 'UPDATE_VEHICLE', plate, detail, form.editReason || '-', ip);
          return {success: true, msg: 'อัปเดตข้อมูลรถเรียบร้อยครับ'};
        }
      }
    } else {
      const newId = 'V_' + new Date().getTime();
      const values = buildVehicleRowValues_(form, [], imgUrl || '', activeStatus);
      sheet.appendRow([newId].concat(values));
      clearAppCache_();
      appendLogRow_(logSheet, actionEmail, 'ADD_VEHICLE', values[0], 'เพิ่มรถใหม่เข้าระบบ', '-', ip);
      return {success: true, msg: 'เพิ่มรถเข้าระบบเรียบร้อยครับ'};
    }
  } catch (error) { return {success: false, msg: error.message}; }
}

function deleteVehicle(id, mode, clientIp, token) {
  try {
    requireMutationAccess_(token);
    const ss = getSpreadsheet_();
    const vSheet = getSheetOrThrow_(ss, 'Vehicles');
    const vData = vSheet.getDataRange().getValues();
    const actionEmail = Session.getActiveUser().getEmail() || 'Unknown User';
    const ip = sanitizeClientIp_(clientIp);
    
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
          appendLogRow_(getSheetOrThrow_(ss, 'Logs'), actionEmail, 'HARD_DELETE', plate, `ลบรถ+ประวัติการจองถาวร (${deletedCount} รายการ)`, 'Admin ลบรถถาวร', ip);
          return {success: true, msg: 'ลบรถและประวัติการจองทั้งหมดแบบถาวรแล้วครับ'};
          
        } else {
          vSheet.getRange(i + 1, 12).setValue('HIDDEN');
          clearAppCache_();
          appendLogRow_(getSheetOrThrow_(ss, 'Logs'), actionEmail, 'SOFT_DELETE', plate, `ซ่อนรถออกจากระบบ`, 'Admin กดซ่อนรถ', ip);
          return {success: true, msg: 'ซ่อนรถคันนี้ออกจากหน้าเว็บเรียบร้อยแล้วครับ'};
        }
      }
    }
    return {success: false, msg: 'ไม่พบรหัสรถคันนี้ในระบบ'};
  } catch(e) { return {success: false, msg: e.message}; }
}

function saveBooking(form, clientIp, token) {
  try {
    requireMutationAccess_(token);
    const ss = getSpreadsheet_();
    const bSheet = getSheetOrThrow_(ss, 'Bookings');
    const bData = bSheet.getDataRange().getValues();
    const ip = resolveClientIp_(clientIp, form);

    const newStart = parseTimeSafe_(form.start);
    const newEnd = parseTimeSafe_(form.end);
    if (!newStart || !newEnd || newStart >= newEnd) {
      return {success: false, msg: 'ช่วงเวลาเริ่ม/สิ้นสุดไม่ถูกต้อง'};
    }

    const groupValidation = validateVehicleGroupBooking_(form.plate, form.dept, form.dest);
    if (!groupValidation.success) return groupValidation;

    const phoneValidation = validateBookingPhone_(form.plate, form.contactPhone);
    if (!phoneValidation.success) return phoneValidation;
    const contactPhone = phoneValidation.phone || '';

    for(let i=1; i<bData.length; i++) {
        if(String(bData[i][1]).trim() === String(form.plate).trim() && String(bData[i][0]).trim() !== String(form.id).trim()) {
            
            // ✨ เพิ่มเช็คการคืนรถ: ถ้ากรอกเลขไมล์คืนรถแล้ว ไม่นับว่าซ้ำซ้อน
            const exEndMile = parseMileageNumberStrict_(bData[i][11]); // ไมล์หลังใช้ (Index 11)
            if (exEndMile !== null && exEndMile > 0) continue;

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

    const mileageValidation = validateBookingMileage_(form, bData, newStart, newEnd);
    if (!mileageValidation.success) return mileageValidation;

    const startMileValue = mileageValidation.startMile;
    const endMileValue = mileageValidation.endMile;
    const hasPostTripMile = endMileValue !== '' && endMileValue > 0;
    const bookingParking = hasPostTripMile ? (form.parkingSpot || '').trim() : '';

    const vData = vSheet.getDataRange().getValues();
    for (let i = 1; i < vData.length; i++) {
      if (String(vData[i][1]).trim() === String(form.plate).trim()) {
        if (hasPostTripMile) {
          vSheet.getRange(i + 1, 8).setValue(endMileValue);
          if (bookingParking) vSheet.getRange(i + 1, 9).setValue(bookingParking);
        }
        break;
      }
    }

    if (form.id) {
      for (let i = 1; i < bData.length; i++) {
        if (String(bData[i][0]).trim() === String(form.id).trim()) {
          bSheet.getRange(i + 1, 2, 1, 13).setValues([[form.plate, fname, lname, form.dept, "'" + form.start, "'" + form.end, form.dest, form.driver, form.originalEmail, startMileValue, endMileValue, bookingParking, contactPhone]]);
          clearAppCache_();
          appendLogRow_(logSheet, actionEmail, 'UPDATE_BOOKING', form.plate, `แก้ไข/คืนรถ (จุดจอด: ${bookingParking || '-'}, ไมล์: ${startMileValue || '-'} -> ${endMileValue || '-'}, โทร: ${contactPhone || '-'})`, form.editReason || '-', ip);
          const lineNotify = notifyCompanyBookingLine_(ss, 'UPDATE', buildBookingNotifyObject_(form, fname, lname, form.id, contactPhone), { skip: form.skipLineNotify });
          return { success: true, msg: 'อัปเดตการจองและจุดจอดเรียบร้อยครับ', lineNotify: lineNotify };
        }
      }
    } else {
      const newBookingId = 'B_' + new Date().getTime();
      bSheet.appendRow([newBookingId, form.plate, fname, lname, form.dept, "'" + form.start, "'" + form.end, form.dest, form.driver, actionEmail, startMileValue, endMileValue, bookingParking, contactPhone]);
      clearAppCache_();
      appendLogRow_(logSheet, actionEmail, 'CREATE_BOOKING', form.plate, `จองไป ${form.dest} (โทร: ${contactPhone || '-'})`, '-', ip);
      const lineNotify = notifyCompanyBookingLine_(ss, 'NEW', buildBookingNotifyObject_(form, fname, lname, newBookingId, contactPhone));
      return { success: true, msg: 'บันทึกการจองสำเร็จครับ', lineNotify: lineNotify };
    }
  } catch (error) { return {success: false, msg: error.message}; }
}

function deleteBooking(id, reason, clientIp, token) {
  if (id && typeof id === 'object') {
    const p = id;
    clientIp = p.clientIp || clientIp || '';
    reason = p.reason != null ? p.reason : reason;
    token = p.token || token || '';
    id = p.id;
  }
  try {
    requireMutationAccess_(token);
    const ss = getSpreadsheet_();
    const bSheet = getSheetOrThrow_(ss, 'Bookings');
    const data = bSheet.getDataRange().getValues();
    const actionEmail = Session.getActiveUser().getEmail() || 'Unknown User';
    const ip = sanitizeClientIp_(clientIp);
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] == id) {
        const plate = data[i][1];
        const dest = data[i][7];
        const startMs = parseTimeSafe_(data[i][5]);
        const isPast = startMs && startMs < Date.now();
        const reasonText = String(reason || '').trim();
        if (isPast && !reasonText) {
          return { success: false, msg: 'การจองนี้ผ่านวันเวลาแล้ว กรุณาระบุเหตุผลในการลบ' };
        }
        const bookingNotify = {
          id: data[i][0],
          plate: data[i][1],
          name: data[i][2],
          surname: data[i][3],
          dept: data[i][4],
          start: data[i][5],
          end: data[i][6],
          dest: data[i][7],
          driver: data[i][8],
          contactPhone: data[i][13] || ''
        };
        bSheet.deleteRow(i + 1);
        clearAppCache_();
        appendLogRow_(getSheetOrThrow_(ss, 'Logs'), actionEmail, 'DELETE_BOOKING', plate, `ลบการจองไป ${dest}`, reasonText || 'ผู้ใช้กดยกเลิก/ลบการจอง', ip);
        notifyCompanyBookingLine_(ss, 'DELETE', bookingNotify);
        return {success: true, msg: 'ลบข้อมูลการจองเรียบร้อยแล้วครับ'};
      }
    }
    return {success: false, msg: 'ไม่พบรหัสการจองนี้ในระบบ'};
  } catch(e) { return {success: false, msg: e.message}; }
}

function setupDailyTrigger() {
  ScriptApp.newTrigger('dailyExpiryCheck').timeBased().atHour(8).everyDays(1).create();
}

function setupNotificationTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    const fn = trigger.getHandlerFunction();
    if (fn === 'deliveryReminderCheck' || fn === 'dailyDeliverySummary') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  ScriptApp.newTrigger('deliveryReminderCheck').timeBased().everyMinutes(15).create();
  ScriptApp.newTrigger('dailyDeliverySummary').timeBased().atHour(8).everyDays(1).create();
}

function getLineConfig_() {
  const props = PropertiesService.getScriptProperties();
  let token = String(props.getProperty('LineChannelAccessToken') || '').trim();
  let groupId = String(props.getProperty('LineGroupId') || '').trim();
  let reminderMin = parseInt(props.getProperty('LineReminderMinutes') || '180', 10) || 180;
  if (!token || !groupId) {
    const ss = getSpreadsheet_();
    setupDatabase();
    const sData = getSheetOrThrow_(ss, 'Settings').getDataRange().getValues();
    for (let i = 1; i < sData.length; i++) {
      if (sData[i][0] === 'LineChannelAccessToken' && !token) token = String(sData[i][1] || '').trim();
      if (sData[i][0] === 'LineGroupId' && !groupId) groupId = String(sData[i][1] || '').trim();
      if (sData[i][0] === 'LineReminderMinutes') reminderMin = parseInt(sData[i][1], 10) || reminderMin;
    }
  }
  return { token: token, groupId: groupId, reminderMin: reminderMin };
}

function appendLineMessageFooter_(text) {
  const body = String(text || '').trim();
  if (!body) return body;
  if (body.indexOf('pongvitsam.github.io/EMD_CAR') >= 0) return body;
  return body + LINE_MESSAGE_FOOTER;
}

function sendLineMessage_(text, cfgOverride) {
  const sent = sendLineMessageDetailed_(text, cfgOverride);
  return sent.success;
}

function sendLineMessageDetailed_(text, cfgOverride) {
  const cfg = Object.assign({}, getLineConfig_(), cfgOverride || {});
  if (!cfg.token) return { success: false, msg: 'ยังไม่ได้ตั้ง Channel Access Token' };
  if (!cfg.groupId) return { success: false, msg: 'ยังไม่ได้ตั้ง Group ID' };
  if (!text) return { success: false, msg: 'ไม่มีข้อความที่จะส่ง' };
  try {
    const res = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + cfg.token },
      payload: JSON.stringify({
        to: cfg.groupId,
        messages: [{ type: 'text', text: String(appendLineMessageFooter_(text)).slice(0, 5000) }]
      }),
      muteHttpExceptions: true
    });
    const code = res.getResponseCode();
    if (code >= 200 && code < 300) return { success: true, msg: 'ส่งข้อความ LINE สำเร็จ' };
    return { success: false, msg: 'LINE API ตอบกลับ ' + code + ': ' + String(res.getContentText() || '').slice(0, 300) };
  } catch (err) {
    return { success: false, msg: String(err.message || err) };
  }
}

function formatLineDateTime_(value) {
  const ms = parseTimeSafe_(value);
  if (!ms) return String(value || '-');
  const d = new Date(ms);
  return Utilities.formatDate(d, 'Asia/Bangkok', 'dd/MM/yyyy HH:mm');
}

function buildBookingNotifyObject_(form, fname, lname, bookingId, contactPhone) {
  return {
    id: bookingId || form.id || '',
    plate: form.plate,
    name: fname,
    surname: lname,
    dept: form.dept,
    start: form.start,
    end: form.end,
    dest: form.dest,
    driver: form.driver,
    contactPhone: contactPhone || form.contactPhone || ''
  };
}

function isCompanyManagedPlate_(ss, plate) {
  const vData = getSheetOrThrow_(ss, 'Vehicles').getDataRange().getValues();
  for (let i = 1; i < vData.length; i++) {
    if (normalizePlateKey_(vData[i][1]) === normalizePlateKey_(plate)) {
      return String(vData[i][20] || '').toUpperCase() === 'COMPANY';
    }
  }
  return false;
}

function formatBookingLineMessage_(eventType, booking) {
  const userName = String((booking.name || '') + ' ' + (booking.surname || '')).trim() || '-';
  const titleMap = {
    NEW: '🚗 จองใหม่ — ส่งรถตามเวลา',
    UPDATE: '✏️ แก้ไขการจอง',
    DELETE: '❌ ยกเลิกการจอง',
    REMINDER: '⏰ เตือนก่อนส่งรถ',
    DAILY: '📋 สรุปรายการส่งรถพรุ่งนี้'
  };
  const lines = [
    titleMap[eventType] || '📢 แจ้งเตือนการจอง',
    'ทะเบียน: ' + (booking.plate || '-'),
    'ผู้จอง: ' + userName + (booking.dept ? ' (' + booking.dept + ')' : ''),
    'เวลา: ' + formatLineDateTime_(booking.start) + ' - ' + formatLineDateTime_(booking.end),
    'จุดหมาย: ' + (booking.dest || '-'),
    'ผู้ขับ: ' + (booking.driver || '-')
  ];
  if (booking.contactPhone) {
    lines.push('📞 ติดต่อ: ' + booking.contactPhone);
  }
  return lines.join('\n');
}

function notifyCompanyBookingLine_(ss, eventType, booking, options) {
  const result = tryNotifyCompanyBookingLine_(ss, eventType, booking, options);
  return result;
}

function tryNotifyCompanyBookingLine_(ss, eventType, booking, options) {
  options = options || {};
  if (options.skip) return { status: 'skipped', reason: 'skip_flag' };
  if (!booking || !booking.plate) return { status: 'skipped', reason: 'no_booking' };
  if (!isCompanyManagedPlate_(ss, booking.plate)) {
    return {
      status: 'skipped',
      reason: 'not_company_car',
      msg: 'รถคันนี้ไม่ได้ตั้งเป็นเก็บ/ส่งโดยบริษัท (TC) — ไม่ส่ง LINE'
    };
  }
  const cfg = getLineConfig_();
  if (!cfg.token || !cfg.groupId) {
    return {
      status: 'failed',
      reason: 'missing_config',
      msg: 'ยังไม่ได้บันทึก LINE Token / Group ID ใน Admin → ตั้งค่าระบบ'
    };
  }
  const sendResult = sendLineMessageDetailed_(formatBookingLineMessage_(eventType, booking));
  return {
    status: sendResult.success ? 'sent' : 'failed',
    reason: sendResult.success ? 'ok' : 'line_api',
    msg: sendResult.msg
  };
}

function getCompanyManagedPlates_(ss) {
  const vData = getSheetOrThrow_(ss, 'Vehicles').getDataRange().getValues();
  const plates = {};
  for (let i = 1; i < vData.length; i++) {
    if (String(vData[i][20] || '').toUpperCase() === 'COMPANY') {
      plates[normalizePlateKey_(vData[i][1])] = vData[i][1];
    }
  }
  return plates;
}

function deliveryReminderCheck() {
  const ss = getSpreadsheet_();
  setupDatabase();
  const cfg = getLineConfig_();
  if (!cfg.token || !cfg.groupId) return;
  const companyPlates = getCompanyManagedPlates_(ss);
  const bData = getSheetOrThrow_(ss, 'Bookings').getDataRange().getValues();
  const now = Date.now();
  const windowMs = cfg.reminderMin * 60 * 1000;
  const cache = CacheService.getScriptCache();

  for (let i = 1; i < bData.length; i++) {
    const plateKey = normalizePlateKey_(bData[i][1]);
    if (!companyPlates[plateKey]) continue;
    const startMs = parseTimeSafe_(bData[i][5]);
    if (!startMs || startMs <= now) continue;
    const diff = startMs - now;
    if (diff > windowMs + 5 * 60 * 1000 || diff < windowMs - 5 * 60 * 1000) continue;
    const bookingId = String(bData[i][0] || '');
    const cacheKey = LINE_REMINDER_CACHE_PREFIX + bookingId;
    if (cache.get(cacheKey) === '1') continue;
    const booking = {
      id: bookingId,
      plate: bData[i][1],
      name: bData[i][2],
      surname: bData[i][3],
      dept: bData[i][4],
      start: bData[i][5],
      end: bData[i][6],
      dest: bData[i][7],
      driver: bData[i][8],
      contactPhone: bData[i][13] || ''
    };
    if (sendLineMessage_(formatBookingLineMessage_('REMINDER', booking))) {
      cache.put(cacheKey, '1', 86400);
    }
  }
}

function dailyDeliverySummary() {
  const ss = getSpreadsheet_();
  setupDatabase();
  const cfg = getLineConfig_();
  if (!cfg.token || !cfg.groupId) return;
  const companyPlates = getCompanyManagedPlates_(ss);
  const bData = getSheetOrThrow_(ss, 'Bookings').getDataRange().getValues();
  const tz = 'Asia/Bangkok';
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const targetKey = Utilities.formatDate(tomorrow, tz, 'yyyy-MM-dd');
  const items = [];

  for (let i = 1; i < bData.length; i++) {
    const plateKey = normalizePlateKey_(bData[i][1]);
    if (!companyPlates[plateKey]) continue;
    const startMs = parseTimeSafe_(bData[i][5]);
    if (!startMs) continue;
    const startKey = Utilities.formatDate(new Date(startMs), tz, 'yyyy-MM-dd');
    if (startKey !== targetKey) continue;
    items.push({
      startMs: startMs,
      line: formatLineDateTime_(bData[i][5]) + ' ' + bData[i][1] + ' — ' +
        String((bData[i][2] || '') + ' ' + (bData[i][3] || '')).trim() +
        (bData[i][4] ? ' (' + bData[i][4] + ')' : '') + ' → ' + (bData[i][7] || '-')
    });
  }

  if (!items.length) {
    sendLineMessage_('📋 สรุปรายการส่งรถพรุ่งนี้\nไม่มีรายการส่งรถของบริษัท');
    return;
  }
  items.sort(function (a, b) { return a.startMs - b.startMs; });
  const body = ['📋 สรุปรายการส่งรถพรุ่งนี้ (' + items.length + ' คัน)']
    .concat(items.map(function (item, idx) { return (idx + 1) + '. ' + item.line; }))
    .join('\n');
  sendLineMessage_(body);
}

function collectUpcomingCompanyBookingItems_(ss, horizonMs) {
  const companyPlates = getCompanyManagedPlates_(ss);
  const bData = getSheetOrThrow_(ss, 'Bookings').getDataRange().getValues();
  const now = Date.now();
  const cutoff = now + (horizonMs || 7 * 24 * 60 * 60 * 1000);
  const items = [];
  for (let i = 1; i < bData.length; i++) {
    const plateKey = normalizePlateKey_(bData[i][1]);
    if (!companyPlates[plateKey]) continue;
    const startMs = parseTimeSafe_(bData[i][5]);
    if (!startMs || startMs <= now || startMs > cutoff) continue;
    items.push({
      startMs: startMs,
      booking: {
        id: String(bData[i][0] || ''),
        plate: bData[i][1],
        name: bData[i][2],
        surname: bData[i][3],
        dept: bData[i][4],
        start: bData[i][5],
        end: bData[i][6],
        dest: bData[i][7],
        driver: bData[i][8],
        contactPhone: bData[i][13] || ''
      }
    });
  }
  items.sort(function (a, b) { return a.startMs - b.startMs; });
  return items;
}

function buildUpcomingCompanyBookingsSummaryText_(items, cfg, options) {
  options = options || {};
  const prefix = options.testPrefix ? '🧪 ทดสอบ LINE\n' : '';
  const title = prefix + '📋 สรุปการจองที่กำลังมาถึง (บริษัท)';
  if (!items.length) return title + '\nไม่มีรายการใน 7 วันข้างหน้า';
  const now = Date.now();
  const reminderMs = (cfg.reminderMin || 180) * 60 * 1000;
  const lines = [title + ' (' + items.length + ' รายการ)'];
  items.forEach(function (item, idx) {
    const b = item.booking;
    const userName = String((b.name || '') + ' ' + (b.surname || '')).trim() || '-';
    let line = (idx + 1) + '. ' + formatLineDateTime_(b.start) + ' ' + (b.plate || '-') + ' — ' + userName;
    if (b.dept) line += ' (' + b.dept + ')';
    line += ' → ' + (b.dest || '-');
    if (b.contactPhone) line += ' | 📞 ' + b.contactPhone;
    if (item.startMs - now <= reminderMs) line += ' ⏰';
    lines.push(line);
  });
  return lines.join('\n');
}

function testLineUpcomingSummary(token, form) {
  try {
    requireAdminSession_(token);
    const ss = getSpreadsheet_();
    setupDatabase();
    const cfg = getLineConfig_();
    const cfgOverride = {};
    if (form && form.lineChannelAccessToken) cfgOverride.token = String(form.lineChannelAccessToken || '').trim();
    if (form && form.lineGroupId) cfgOverride.groupId = String(form.lineGroupId || '').trim();
    const effectiveCfg = Object.assign({}, cfg, cfgOverride);
    if (!effectiveCfg.token || !effectiveCfg.groupId) {
      return { success: false, msg: 'กรุณาใส่ Channel Access Token และ Group ID ก่อนทดสอบ' };
    }
    const items = collectUpcomingCompanyBookingItems_(ss);
    const text = buildUpcomingCompanyBookingsSummaryText_(items, effectiveCfg, { testPrefix: true });
    return sendLineMessageDetailed_(text, cfgOverride);
  } catch (err) {
    return { success: false, msg: String(err.message || err) };
  }
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
function quickUpdateMileage(id, plate, newMile, clientIp, token) {
  try {
    requireMutationAccess_(token);
    const ss = getSpreadsheet_();
    const sheet = getSheetOrThrow_(ss, 'Vehicles');
    const data = sheet.getDataRange().getValues();
    const actionEmail = Session.getActiveUser().getEmail() || 'Unknown User';
    const ip = sanitizeClientIp_(clientIp);
    
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] == id) {
        sheet.getRange(i + 1, 8).setValue(newMile); 
        clearAppCache_();
        appendLogRow_(getSheetOrThrow_(ss, 'Logs'), actionEmail, 'UPDATE_MILEAGE', plate, `แก้ไขไมล์ด่วน: ${newMile} km`, 'แก้เลขไมล์ที่กรอกผิด', ip);
        return { success: true, msg: 'อัปเดตเลขไมล์เรียบร้อยครับ' };
      }
    }
    return { success: false, msg: 'ไม่พบรถในระบบ' };
  } catch(e) { return { success: false, msg: e.message }; }
}