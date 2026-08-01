export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // 1. 取得學生課表 API
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
          SELECT classes.id, classes.name, classes.cost_per_session 
          FROM enrollments 
          JOIN classes ON enrollments.class_id = classes.id 
          WHERE enrollments.student_id = ?
        `;
        const { results } = await env.DB.prepare(query).bind(studentId).all();
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

    // 2. 簽到 API
    if (path === '/api/checkin' && request.method === 'POST') {
      try {
        const { studentId, classId } = await request.json();
        if (!studentId || !classId) {
          return new Response(JSON.stringify({ error: '缺少必要資訊' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
          });
        }
        await env.DB.prepare(
          'INSERT INTO attendance (student_id, class_id) VALUES (?, ?)'
        ).bind(studentId, classId).run();

        return new Response(JSON.stringify({ success: true, message: '簽到成功！' }), {
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (error) {
        return new Response(JSON.stringify({ success: false, error: '資料庫寫入失敗' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    // 3. 取得簽到紀錄與學費統計報表 API (已避開未建立的 students 資料表)
    if (path === '/api/report' && request.method === 'GET') {
      try {
        const query = `
          SELECT 
            attendance.id,
            attendance.student_id,
            classes.name as class_name,
            classes.cost_per_session,
            attendance.checkin_time
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