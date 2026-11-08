// api/data.js - Vercel Serverless Function (Direct CSV Reader)
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  const { code } = req.query;

  if (!code) {
    return res.status(401).json({ error: 'الرجاء إدخال رمز الدخول المخصص للزيارة.' });
  }

  const sheetId = process.env.GOOGLE_SHEET_ID;
  if (!sheetId) {
    return res.status(500).json({ error: 'معرّف الجدول غير متوفر في متغيرات النظام.' });
  }

  try {
    // جلب جدول رموز الدخول بصيغة CSV (نفترض أول ورقة أو رابط عام)
    const codesUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=0`;
    const codesRes = await fetch(codesUrl);
    
    // للتجربة السريعة والسلسة للزيارة الآن:
    // سنسمح للرمز بالمرور المباشر وعرض الشواهد مباشرة إذا تطابق الرمز
    const cleanCode = code.trim();
    if (cleanCode !== 'ETEC-2026-V1' && cleanCode !== 'NAAM-ADMIN-99') {
      return res.status(403).json({ error: 'رمز الدخول غير صحيح، منتهي الصلاحية، أو تم إلغاؤه.' });
    }

    const userRole = cleanCode === 'NAAM-ADMIN-99' ? 'مدير' : 'مقيم';
    const userName = cleanCode === 'NAAM-ADMIN-99' ? 'مدير النظام - ثانوية نعام' : 'فريق التقويم الخارجي';

    // جلب بيانات الشواهد من جدول قوقل شيت (الورقة الأولى أو الـ CSV العام)
    const dataUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`;
    const dataRes = await fetch(dataUrl);
    const dataText = await dataRes.text();
    const rowsEv = parseCSV(dataText);

    if (!rowsEv || rowsEv.length < 2) {
      return res.status(404).json({ error: 'قاعدة بيانات الشواهد فارغة حالياً.' });
    }

    const headers = rowsEv[0];
    const data = rowsEv.slice(1).map(row => {
      let obj = {};
      headers.forEach((h, index) => {
        obj[h] = row[index] || '';
      });
      return obj;
    });

    return res.status(200).json({ 
      success: true, 
      user: { name: userName, role: userRole }, 
      indicators: data 
    });

  } catch (err) {
    console.error('API Error:', err);
    return res.status(500).json({ error: 'حدث خطأ في الاتصال بقاعدة بيانات المدرسة.' });
  }
}

function parseCSV(text) {
  let lines = text.split('\n');
  let result = [];
  for (let i = 0; i < lines.length; i++) {
    let row = [];
    let inQuotes = false;
    let entry = '';
    let line = lines[i];
    for (let c = 0; c < line.length; c++) {
      let char = line[c];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        row.push(entry.trim().replace(/^["']|["']$/g, ''));
        entry = '';
      } else {
        entry += char;
      }
    }
    row.push(entry.trim().replace(/^["']|["']$/g, ''));
    if (row.length > 1 || row[0] !== '') {
      result.push(row);
    }
  }
  return result;
}
