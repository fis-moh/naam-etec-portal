// api/data.js - Vercel Serverless Function (Naam Complex 1448H)
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  const { code } = req.query;

  if (!code || !code.trim()) {
    return res.status(401).json({ error: 'الرجاء إدخال رمز التصريح الأمني.' });
  }

  // معرّف الجدول الجديد
  const envId = (process.env.GOOGLE_SHEET_ID || '').trim();
  const matchId = envId.match(/[-\w]{25,}/);
  const sheetId = matchId ? matchId[0] : '1IA9v2Pasjc7_sxurx4_FrsZ-6E4s0q4gdvtB3UIHpjM';

  const cleanCode = code.trim().toUpperCase();

  try {
    // 1. التحقق من صلاحيات رمز الدخول
    let validUser = null;

    // فحص أمني سريع للرموز القياسية 1448هـ
    const staticCodes = {
      'ETEC-PRI-1448': { name: 'فريق تقويم المرحلة الابتدائية', stage: 'ابتدائي', role: 'مقيم' },
      'ETEC-INT-1448': { name: 'فريق تقويم المرحلة المتوسطة', stage: 'متوسط', role: 'مقيم' },
      'ETEC-SEC-1448': { name: 'فريق تقويم المرحلة الثانوية', stage: 'ثانوي', role: 'مقيم' },
      'ETEC-2026-V1': { name: 'رئيس فريق التقويم الخارجي للمجمع', stage: 'الكل', role: 'مقيم_عام' },
      'NAAM-ADMIN-99': { name: 'مدير المجمع (أ. زيد آل داود)', stage: 'الكل', role: 'مدير' }
    };

    if (staticCodes[cleanCode]) {
      validUser = staticCodes[cleanCode];
    }

    // فحص إضافي من ورقة "رموز_الدخول" إن وجدت تحديثات لاحقة
    if (!validUser) {
      const codesData = await fetchSheetData(sheetId, 'رموز_الدخول');
      if (codesData && codesData.length > 1) {
        for (let i = 1; i < codesData.length; i++) {
          const r = codesData[i];
          const rCode = (r[0] || '').trim().toUpperCase();
          const rStatus = (r[5] || '').trim();
          if (rCode === cleanCode && (rStatus === 'مفعل' || rStatus === 'نشط' || rStatus === '')) {
            validUser = {
              name: (r[1] || 'عضو التقويم الخارجي').trim(),
              stage: (r[2] || 'الكل').trim(),
              role: (r[3] || 'مقيم').trim()
            };
            break;
          }
        }
      }
    }

    if (!validUser) {
      return res.status(403).json({ error: 'رمز الدخول غير صحيح أو لم يعد مفعلًا.' });
    }

    // 2. جلب بيانات ورقة "خطة_التحسين"
    const actionsRaw = await fetchSheetData(sheetId, 'خطة_التحسين');
    const improvementActions = [];
    if (actionsRaw && actionsRaw.length > 1) {
      for (let i = 1; i < actionsRaw.length; i++) {
        const r = actionsRaw[i];
        if (!r || r.length < 5 || !r[2]) continue;
        improvementActions.push({
          stage: (r[0] || '').trim(),
          domain: (r[1] || '').trim(),
          code: (r[2] || '').trim(),
          element: (r[3] || '').trim(),
          previousScore: (r[4] || '').trim(),
          targetScore: (r[5] || 'تميز (+90%)').trim(),
          actionName: (r[6] || '').trim(),
          method: (r[7] || '').trim(),
          description: (r[8] || '').trim(),
          responsible: (r[9] || '').trim(),
          date: (r[10] || '').trim(),
          evidenceUrl: (r[11] || '').trim(),
          status: (r[12] || 'مكتمل').trim()
        });
      }
    }

    // 3. جلب بيانات ورقة "السجلات_والمعايير"
    const recordsRaw = await fetchSheetData(sheetId, 'السجلات_والمعايير');
    const operationalRecords = [];
    if (recordsRaw && recordsRaw.length > 1) {
      for (let i = 1; i < recordsRaw.length; i++) {
        const r = recordsRaw[i];
        if (!r || r.length < 4 || !r[3]) continue;
        operationalRecords.push({
          stage: (r[0] || '').trim(),
          domain: (r[1] || '').trim(),
          standard: (r[2] || '').trim(),
          recordName: (r[3] || '').trim(),
          responsible: (r[4] || '').trim(),
          evidenceUrl: (r[5] || '').trim(),
          verificationLevel: (r[6] || 'متحقق بدرجة عالية').trim()
        });
      }
    }

    return res.status(200).json({
      success: true,
      user: validUser,
      data: {
        improvementActions,
        operationalRecords
      }
    });

  } catch (err) {
    console.error('Server Handler Error:', err);
    return res.status(500).json({ error: 'تعذر الاتصال بقاعدة البيانات. تأكد من إعدادات المشاركة للجدول.' });
  }
}

// دالة مساعدة لجلب وقراءة بيانات أي ورقة
async function fetchSheetData(sheetId, sheetName) {
  const urls = [
    `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`,
    `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&sheet=${encodeURIComponent(sheetName)}`
  ];

  for (const url of urls) {
    try {
      const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (resp.ok) {
        const text = await resp.text();
        if (text && !text.trim().startsWith('<!DOCTYPE') && !text.trim().startsWith('<html')) {
          return parseCSV(text);
        }
      }
    } catch (e) {}
  }
  return null;
}

// محلل CSV يدعم النصوص العربية والفواصل وعلامات التنصيص
function parseCSV(csvText) {
  const clean = csvText.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const rows = [];
  let row = [];
  let val = '';
  let inQuotes = false;

  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    const next = clean[i + 1];

    if (c === '"') {
      if (inQuotes && next === '"') {
        val += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === ',' && !inQuotes) {
      row.push(val.trim());
      val = '';
    } else if (c === '\n' && !inQuotes) {
      row.push(val.trim());
      if (row.some(cell => cell !== '')) rows.push(row);
      row = [];
      val = '';
    } else {
      val += c;
    }
  }

  if (val !== '' || row.length > 0) {
    row.push(val.trim());
    if (row.some(cell => cell !== '')) rows.push(row);
  }

  return rows;
}
