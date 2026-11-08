// api/data.js - Vercel Serverless Function (Direct GID & Multi-Fallback Reader)
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  const { code } = req.query;

  if (!code || !code.trim()) {
    return res.status(401).json({ error: 'الرجاء إدخال رمز التصريح الأمني.' });
  }

  // استخدام المعرف الصحيح مباشرة مع دعم متغير البيئة
  const envId = (process.env.GOOGLE_SHEET_ID || '').trim();
  const matchId = envId.match(/[-\w]{25,}/);
  const sheetId = matchId ? matchId[0] : '1huQAz2lPt2FSFNZnsd2jyrNqrK3cy-V0ncyvVLN3Ny8';

  const cleanCode = code.trim().toUpperCase();

  try {
    // 1. التحقق من رمز الدخول
    let validUser = null;

    if (cleanCode === 'ETEC-2026-V1') {
      validUser = { name: 'رئيس فريق التقويم الخارجي', role: 'مقيم' };
    } else if (cleanCode === 'ETEC-2026-V2') {
      validUser = { name: 'عضو فريق التقويم الخارجي', role: 'مقيم' };
    } else if (cleanCode === 'NAAM-ADMIN-99') {
      validUser = { name: 'مدير النظام - مجمع مدارس نعام', role: 'مدير' };
    }

    // فحص إضافي من ورقة رموز_الدخول في حال إضافة رموز جديدة مستقبلاً
    if (!validUser) {
      try {
        const codesUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent('رموز_الدخول')}`;
        const codesRes = await fetch(codesUrl);
        if (codesRes.ok) {
          const codesText = await codesRes.text();
          if (!codesText.trim().startsWith('<!DOCTYPE') && !codesText.trim().startsWith('<html')) {
            const codesRows = parseCSV(codesText);
            for (let i = 1; i < codesRows.length; i++) {
              const r = codesRows[i];
              const rCode = (r[0] || '').trim().toUpperCase();
              const rStatus = (r[4] || '').trim();
              if (rCode === cleanCode && (rStatus === 'مفعل' || rStatus === 'نشط' || rStatus === '')) {
                validUser = { name: (r[1] || 'لجنة التقويم الخارجي').trim(), role: (r[2] || 'مقيم').trim() };
                break;
              }
            }
          }
        }
      } catch (e) {
        // المتابعة في حال تعذر قراءة ورقة الرموز الإضافية
      }
    }

    if (!validUser) {
      return res.status(403).json({ error: 'رمز الوصول غير صحيح أو منتهي الصلاحية.' });
    }

    // 2. جلب بيانات ورقة "الشواهد" عبر 3 مسارات احتياطية مضمونة (بالـ GID المباشر ثم بالاسم)
    const urlsToTry = [
      `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=2006986801`,
      `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&gid=2006986801`,
      `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent('الشواهد')}`,
      `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`
    ];

    let evText = '';
    for (const url of urlsToTry) {
      try {
        const resp = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NaamPortal/1.0)' }
        });
        if (resp.ok) {
          const text = await resp.text();
          // التأكد من أن الاستجابة بيانات جدول وليست صفحة تسجيل دخول HTML من قوقل
          if (text && !text.trim().startsWith('<!DOCTYPE') && !text.trim().startsWith('<html')) {
            evText = text;
            break;
          }
        }
      } catch (e) {
        // تجربة الرابط البديل
      }
    }

    if (!evText) {
      return res.status(500).json({
        error: 'الجدول مقفل في قوقل شيت. اضغط زر (مشاركة / Share) الأخضر أعلى يسار الجدول واجعل الوصول العام: (أي شخص لديه الرابط - عارض).'
      });
    }

    const rowsEv = parseCSV(evText);

    if (!rowsEv || rowsEv.length < 2) {
      return res.status(404).json({ error: 'ورقة (الشواهد) فارغة حالياً.' });
    }

    const indicators = [];
    for (let i = 1; i < rowsEv.length; i++) {
      const r = rowsEv[i];
      if (!r || r.length < 3 || (!r[0] && !r[3])) continue;

      const cleanIndCode = (r[0] || '').replace(/^'+/, '').trim();
      // تخطي صف العنوان إذا تكرر
      if (cleanIndCode === 'رقم_المؤشر' || cleanIndCode === 'رقم المؤشر') continue;

      indicators.push({
        code: cleanIndCode,
        domain: (r[1] || '').trim(),
        standard: (r[2] || '').trim(),
        text: (r[3] || '').trim(),
        selfScore: (r[4] || '').trim(),
        level: (r[5] || '').trim(),
        evidenceTitle: (r[6] || '').trim(),
        evidenceUrl: (r[7] || '').trim(),
        fileType: (r[8] || 'PDF').trim(),
        proofDesc: (r[9] || '').trim(),
        year: (r[10] || '1447').trim(),
        status: (r[11] || 'مكتمل').trim(),
        sensitivity: (r[12] || 'عام').trim(),
        folderUrl: (r[13] || '').trim()
      });
    }

    return res.status(200).json({
      success: true,
      user: validUser,
      indicators
    });

  } catch (err) {
    console.error('Server Error:', err);
    return res.status(500).json({ error: 'حدث خطأ أثناء الاتصال بقاعدة البيانات.' });
  }
}

function parseCSV(csvText) {
  const cleanText = csvText.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const rows = [];
  let currentRow = [];
  let currentVal = '';
  let inQuotes = false;

  for (let i = 0; i < cleanText.length; i++) {
    const char = cleanText[i];
    const nextChar = cleanText[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        currentVal += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      currentRow.push(currentVal.trim());
      currentVal = '';
    } else if (char === '\n' && !inQuotes) {
      currentRow.push(currentVal.trim());
      if (currentRow.some(cell => cell !== '')) {
        rows.push(currentRow);
      }
      currentRow = [];
      currentVal = '';
    } else {
      currentVal += char;
    }
  }

  if (currentVal !== '' || currentRow.length > 0) {
    currentRow.push(currentVal.trim());
    if (currentRow.some(cell => cell !== '')) {
      rows.push(currentRow);
    }
  }

  return rows;
}
