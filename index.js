export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // 自動確保資料庫結構與欄位完整
    try {
      await env.DB.prepare("ALTER TABLE attendance ADD COLUMN checkin_time TEXT;").run();
    } catch (e) {}

    try {
      await env.DB.prepare("CREATE TABLE IF NOT EXISTS students (id TEXT PRIMARY KEY, name TEXT);").run();
      await env.DB.prepare("INSERT OR IGNORE INTO students (id, name) VALUES ('student_001', '陳小華');").run();
    } catch (e) {}

    // 1. 取得所有學生清單 API
    if (path === '/api/students' && request.method === 'GET') {
      try {
        let students = [];
        try {
          const res = await env.DB.prepare('SELECT id as student_id, name FROM students').all();
          students = res.results;
        } catch (e) {
          const res = await env.DB.prepare('SELECT DISTINCT student_id FROM enrollments').all();
          students = res.results.map(r => ({ student_id: r.student_id, name: r.student_id }));
        }
        return new Response(JSON.stringify(students), {
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    // 2. 取得指定學生的課表與是否已點名狀態
    if (path === '/api/student-classes' && request.method === 'GET') {
      const studentId = url.searchParams.get('studentId');
      if (!studentId) {
        return new Response(JSON.stringify({ error: '缺少 studentId' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
      }
      try {
        const query = `
          SELECT classes.id, classes.name, classes.cost_per_session,
                 (SELECT COUNT(1) FROM attendance WHERE attendance.student_id = ? AND attendance.class_id = classes.id) as is_checked_in
          FROM enrollments 
          JOIN classes ON enrollments.class_id = classes.id 
          WHERE enrollments.student_id = ?
        `;
        const { results } = await env.DB.prepare(query).bind(studentId, studentId).all();
        return new Response(JSON.stringify(results), {
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    // 3. 老師點名 API (後端嚴格防重複點名)
    if (path === '/api/checkin' && request.method === 'POST') {
      try {
        const { studentId, classId } = await request.json();
        if (!studentId || !classId) {
          return new Response(JSON.stringify({ success: false, error: '缺少必要資訊' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        // 再次在後端檢查是否已經點過名
        const existing = await env.DB.prepare(
          'SELECT id FROM attendance WHERE student_id = ? AND class_id = ?'
        ).bind(studentId, classId).first();

        if (existing) {
          return new Response(JSON.stringify({ success: false, error: '此學生已經點過該課程，無法重複點名！' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        // 取得詳細台灣時間
        const now = new Date();
        const taiwanTime = new Intl.DateTimeFormat('zh-TW', {
          timeZone: 'Asia/Taipei',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false
        }).format(now).replace(/\//g, '-');

        await env.DB.prepare(
          'INSERT INTO attendance (student_id, class_id, checkin_time) VALUES (?, ?, ?)'
        ).bind(studentId, classId, taiwanTime).run();

        return new Response(JSON.stringify({ success: true, message: '點名成功！' }), {
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (error) {
        return new Response(JSON.stringify({ success: false, error: '資料庫寫入失敗: ' + error.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    // 4. 老師取消點名 API
    if (path === '/api/cancel-checkin' && request.method === 'POST') {
      try {
        const { id } = await request.json();
        if (!id) {
          return new Response(JSON.stringify({ success: false, error: '缺少紀錄 ID' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
          });
        }
        await env.DB.prepare('DELETE FROM attendance WHERE id = ?').bind(id).run();
        return new Response(JSON.stringify({ success: true, message: '已取消點名' }), {
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (error) {
        return new Response(JSON.stringify({ success: false, error: error.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    // 5. 取得所有點名紀錄與學費統計報表 API (顯示學生姓名與詳細時間)
    if (path === '/api/report' && request.method === 'GET') {
      try {
        const query = `
          SELECT 
            attendance.id,
            attendance.student_id,
            COALESCE(students.name, attendance.student_id) as student_name,
            classes.name as class_name,
            classes.cost_per_session,
            COALESCE(attendance.checkin_time, '未知時間') as checkin_time
          FROM attendance
          LEFT JOIN students ON attendance.student_id = students.id
          JOIN classes ON attendance.class_id = classes.id
          ORDER BY attendance.id DESC
        `;
        const { results } = await env.DB.prepare(query).all();
        return new Response(JSON.stringify(results), {
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    return new Response('Not Found', { status: 404 });
  }
};