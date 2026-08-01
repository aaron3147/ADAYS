export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // 1. 取得所有學生清單 API (從選課表中自動抓取現有學生)
    if (path === '/api/students' && request.method === 'GET') {
      try {
        const { results } = await env.DB.prepare('SELECT DISTINCT student_id FROM enrollments').all();
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

    // 2. 取得指定學生的課表與簽到狀態 API
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

    // 3. 老師執行點名 API (防重複點名檢核)
    if (path === '/api/checkin' && request.method === 'POST') {
      try {
        const { studentId, classId } = await request.json();
        if (!studentId || !classId) {
          return new Response(JSON.stringify({ error: '缺少必要資訊' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        // 檢查是否已經點過名
        const existing = await env.DB.prepare(
          'SELECT id FROM attendance WHERE student_id = ? AND class_id = ?'
        ).bind(studentId, classId).first();

        if (existing) {
          return new Response(JSON.stringify({ success: false, error: '此課程已經點過名了，請勿重複點名！' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
          });
        }

        await env.DB.prepare(
          'INSERT INTO attendance (student_id, class_id) VALUES (?, ?)'
        ).bind(studentId, classId).run();

        return new Response(JSON.stringify({ success: true, message: '點名成功！' }), {
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (error) {
        return new Response(JSON.stringify({ success: false, error: '資料庫寫入失敗' }), {
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

    // 5. 取得所有點名紀錄與學費統計報表 API
    if (path === '/api/report' && request.method === 'GET') {
      try {
        const query = `
          SELECT 
            attendance.id,
            attendance.student_id,
            classes.name as class_name,
            classes.cost_per_session
          FROM attendance
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