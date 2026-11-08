// api/data.js - Vercel Serverless Function
const { google } = require('googleapis');

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  const { code } = req.query;

  if (!code) {
    return res.status(401).json({ error: 'الرجاء إدخال رمز الدخول المخصص للزيارة.' });
  }

  try {
    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY ? process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n') : undefined,
      },
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });

    const sheets = google.sheets({ version: 'v4', auth });
    const spreadsheetId = process.env.GOOGLE_SHEET_ID;

    const codesRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'رموز_الدخول!A:E',
    });

    const rowsCodes = codesRes.data.values;
    if (!rowsCodes || rowsCodes.length < 2) {
      return res.status(403).json({ error: 'لم يتم العثور على رموز دخول مسجلة.' });
    }

    let validUser = null;
    for (let i = 1; i < rowsCodes.length; i++) {
      const row = rowsCodes[i];
      if (row[0] === code && row[4] === 'مفعل') {
        const expDate = new Date(row[3]);
        if (new Date() <= expDate) {
          validUser = { name: row[1], role: row[2] };
          break;
        }
      }
    }

    if (!validUser) {
      return res.status(403).json({ error: 'رمز الدخول غير صحيح، منتهي الصلاحية، أو تم إلغاؤه.' });
    }

    const sheetRes = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'الشواهد!A:N',
    });

    const rowsEv = sheetRes.data.values;
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

    try {
      const timestamp = new Date().toLocaleString('ar-SA', { timeZone: 'Asia/Riyadh' });
      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: 'سجل_الدخول!A:E',
        valueInputOption: 'USER_ENTERED',
        resource: {
          values: [[timestamp, code, validUser.name, 'نجاح الدخولقبول', req.headers['user-agent'] || 'Unknown']]
        }
      });
    } catch (logErr) {
      console.error('Log error:', logErr);
    }

    return res.status(200).json({ success: true, user: validUser, indicators: data });

  } catch (err) {
    console.error('API Error:', err);
    return res.status(500).json({ error: 'حدث خطأ في الاتصال بقاعدة بيانات المدرسة.' });
  }
}
