// api/data.js - Vercel Serverless Function
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  const { code } = req.query;

  if (!code || !code.trim()) {
    return res.status(401).json({ error: 'الرجاء إدخال رمز الوصول المعتمد.' });
  }

  // تنظيف معرف الجدول من أي مسافات أو علامات زائدة
  const rawSheetId = (process.env.GOOGLE_SHEET_ID || '').trim();
  const sheetIdMatch = rawSheetId.match(/[-\w]{25,}/);
  const sheetId = sheetIdMatch ? sheetIdMatch[0] : rawSheetId;

  if (!sheetId) {
    return res.status(500).json({ error: 'معرّف قاعدة البيانات (GOOGLE_SHEET_ID) غير مضبوط في إعدادات Vercel.' });
  }

  const cleanCode = code.trim().toUpperCase();

  try {
    // 1. فحص رمز الدخول من ورقة "رموز_الدخول"
    const codesUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent('رموز_الدخول')}`;
    const codesRes = await fetch(codesUrl);

    let validUser = null;

    if (codesRes.ok) {
      const codesText = await codesRes.text();
      const codesRows = parseCSV(codesText);

      for (let i = 1; i < codesRows.length; i++) {
        const row = codesRows[i];
        const rowCode = (row[0] || '').trim().toUpperCase();
        const rowName = (row[1] || '').trim();
        const rowRole = (row[2] || '').trim();
        const rowExp = (row[3] || '').trim();
        const rowStatus = (row[4] || '').trim();

        if (rowCode === cleanCode && (rowStatus === 'مفعل' || rowStatus === 'نشط' || rowStatus === '')) {
          const expDate = new Date(rowExp);
          if (isNaN(expDate.getTime()) || new Date() <= expDate) {
            validUser = { name: rowName || 'لجنة التقويم الخارجي', role: rowRole || 'مقيم' };
            break;
          }
        }
      }
    }

    // رموز احتياطية معتمدة في حال تأخر مزامنة ورقة الرموز
    if (!validUser) {
      if (cleanCode === 'ETEC-2026-V1') {
        validUser = { name: 'رئيس فريق التقويم الخارجي', role: 'مقيم' };
      } else if (cleanCode === 'ETEC-2026-V2') {
        validUser = { name: 'عضو فريق التقويم الخارجي', role: 'مقيم' };
      } else if (cleanCode === 'NAAM-ADMIN-99') {
        validUser = { name: 'مدير النظام - ثانوية نعام', role: 'مدير' };
      }
    }

    if (!validUser) {
      return res.status(403).json({ error: 'رمز الوصول غير صحيح أو منتهي الصلاحية.' });
    }

    // 2. جلب بيانات المؤشرات الـ 45 من ورقة "الشواهد" بالاسم مباشرة
    const evUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent('الشواهد')}`;
    const evRes = await fetch(evUrl);

    if (!evRes.ok) {
      return res.status(500).json({ error: 'تعذر الوصول إلى ورقة (الشواهد). تأكد من مشاركة الجدول للعموم (عارض).' });
    }

    const evText = await evRes.text();
    const rowsEv = parseCSV(evText);

    if (!rowsEv || rowsEv.length < 2) {
      return res.status(404).json({ error: 'ورقة (الشواهد) فارغة أو لم يتم بناؤها بعد.' });
    }

    // تحويل الصفوف إلى كائنات موحدة ومضمونة المفاتيح
    const indicators = [];
    for (let i = 1; i < rowsEv.length; i++) {
      const r = rowsEv[i];
      // تخطي الصفوف الفارغة تماماً
      if (!r || r.length < 3 || (!r[0] && !r[3])) continue;

      const cleanIndCode = (r[0] || '').replace(/^'+/, '').trim();

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
    return res.status(500).json({ error: 'حدث خطأ أثناء قراءة قاعدة البيانات. تأكد من صلاحية مشاركة الملف.' });
  }
}

// محلل CSV قياسي يدعم الفواصل داخل النصوص العربية والأسطر المتعددة
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
