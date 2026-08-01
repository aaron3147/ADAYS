export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // 1. 取得選項基礎資料 (類別、教室、老師)
    if (path === '/api/meta' && request.method === 'GET') {
      try {
        const categories = (await env.DB.prepare('SELECT * FROM categories').all()).results;
        const classrooms = (await env.DB.prepare('SELECT * FROM classrooms').all()).results;
        const teachers = (await env.DB.prepare('SELECT * FROM teachers').all()).results;
        return new Response(JSON.stringify({ categories, classrooms, teachers }), {
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
      }
    }

    // 2. 新增選項 (類別/教室/老師)
    if (path === '/api/meta/add' && request.method === 'POST') {
      try {
        const { type, name } = await request.json();
        if (!type || !name) return new Response(JSON.stringify({ success: false, error: '缺少參數' }), { status: 400 });
        let table = type === 'category' ? 'categories' : type === 'classroom' ? 'classrooms' : 'teachers';
        await env.DB.prepare(`INSERT OR IGNORE INTO ${table} (name) VALUES (?)`).bind(name).run();
        return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
      } catch (err) {
        return new Response(JSON.stringify({ success: false, error: err.message }), { status: 500 });
      }
    }

    // 3. 取得所有課程清單 (用於課表總覽區)
    if (path === '/api/courses' && request.method === 'GET') {
      try {
        const query = `
          SELECT courses.*, categories.name as category_name, teachers.name as teacher_name, classrooms.name as classroom_name
          FROM courses
          LEFT JOIN categories ON courses.category_id = categories.id
          LEFT JOIN teachers ON courses.teacher_id = teachers.id
          LEFT JOIN classrooms ON courses.classroom_id = classrooms.id
          ORDER BY courses.day_of_week ASC, courses.start_time ASC
        `;
        const { results } = await env.DB.prepare(query).all();
        return new Response(JSON.stringify(results), { headers: { 'Content-Type': 'application/json' } });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
      }
    }

    // 4. 建立課程與週期排程
    if (path === '/api/courses/create' && request.method === 'POST') {
      try {
        const { category_id, name, teacher_id, classroom_id, day_of_week, start_time, end_time, start_date, end_date, school_target } = await request.json();
        await env.DB.prepare(`
          INSERT INTO courses (category_id, name, teacher_id, classroom_id, day_of_week, start_time, end_time, start_date, end_date, school_target)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(category_id, name, teacher_id, classroom_id, day_of_week, start_time, end_time, start_date, end_date, school_target).run();
        return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
      } catch (err) {
        return new Response(JSON.stringify({ success: false, error: err.message }), { status: 500 });
      }
    }

    // 5. 學生資料管理 (取得列表)
    if (path === '/api/students' && request.method === 'GET') {
      try {
        const { results } = await env.DB.prepare('SELECT * FROM students ORDER BY id DESC').all();
        return new Response(JSON.stringify(results), { headers: { 'Content-Type': 'application/json' } });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
      }
    }

    // 6. 建立學生完整資料
    if (path === '/api/students/create' && request.method === 'POST') {
      try {
        const data = await request.json();
        await env.DB.prepare(`
          INSERT INTO students (chinese_name, english_name, gender, birth_date, school, grade, parent_name, parent_phone, password)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, '1234')
        `).bind(data.chinese_name, data.english_name, data.gender, data.birth_date, data.school, data.grade, data.parent_name, data.parent_phone).run();
        return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
      } catch (err) {
        return new Response(JSON.stringify({ success: false, error: '建立失敗或手機號碼已註冊: ' + err.message }), { status: 500 });
      }
    }

    // 7. 家長手機登入驗證
    if (path === '/api/parent/login' && request.method === 'POST') {
      try {
        const { phone, password } = await request.json();
        const student = await env.DB.prepare('SELECT * FROM students WHERE parent_phone = ? AND password = ?').bind(phone, password || '1234').first();
        if (student) {
          return new Response(JSON.stringify({ success: true, student }), { headers: { 'Content-Type': 'application/json' } });
        } else {
          return new Response(JSON.stringify({ success: false, error: '手機號碼或密碼錯誤 (預設密碼為 1234)' }), { status: 400 });
        }
      } catch (err) {
        return new Response(JSON.stringify({ success: false, error: err.message }), { status: 500 });
      }
    }

    // 8. 取得點名報表
    if (path === '/api/report' && request.method === 'GET') {
      try {
        const query = `
          SELECT attendance.id, students.chinese_name as student_name, courses.name as class_name,
                 COALESCE(categories.name, '一般') as category_name, attendance.checkin_time
          FROM attendance
          LEFT JOIN students ON attendance.student_id = students.id
          LEFT JOIN courses ON attendance.course_id = courses.id
          LEFT JOIN categories ON courses.category_id = categories.id
          ORDER BY attendance.id DESC
        `;
        const { results } = await env.DB.prepare(query).all();
        return new Response(JSON.stringify(results), { headers: { 'Content-Type': 'application/json' } });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500 });
      }
    }

    return new Response('Not Found', { status: 404 });
  }
};