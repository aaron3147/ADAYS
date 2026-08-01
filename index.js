export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    const jsonRes = (data, status = 200) => new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json' }
    });

    try {
      // 1. 三層課程名稱管理 API (取得與新增)
      if (path.startsWith('/api/levels/') && method === 'GET') {
        const level = path.split('/')[3]; // level1, level2, level3
        const { results } = await env.DB.prepare(`SELECT * FROM course_${level}`).all();
        return jsonRes(results);
      }
      if (path.startsWith('/api/levels/') && method === 'POST') {
        const level = path.split('/')[3];
        const { name } = await request.json();
        if (!name) return jsonRes({ success: false, error: '名稱不能為空' }, 400);
        await env.DB.prepare(`INSERT OR IGNORE INTO course_${level} (name) VALUES (?)`).bind(name).run();
        return jsonRes({ success: true });
      }

      // 取得所有選單基礎資料
      if (path === '/api/meta' && method === 'GET') {
        const level1 = (await env.DB.prepare('SELECT * FROM course_level1').all()).results;
        const level2 = (await env.DB.prepare('SELECT * FROM course_level2').all()).results;
        const level3 = (await env.DB.prepare('SELECT * FROM course_level3').all()).results;
        const classrooms = (await env.DB.prepare('SELECT * FROM classrooms').all()).results;
        const teachers = (await env.DB.prepare('SELECT * FROM teachers').all()).results;
        return jsonRes({ level1, level2, level3, classrooms, teachers });
      }

      if (path === '/api/meta/add' && method === 'POST') {
        const { type, name } = await request.json();
        const table = type === 'teacher' ? 'teachers' : 'classrooms';
        await env.DB.prepare(`INSERT OR IGNORE INTO ${table} (name) VALUES (?)`).bind(name).run();
        return jsonRes({ success: true });
      }

      // 2. 課程與區間週期建立
      if (path === '/api/courses' && method === 'GET') {
        const query = `
          SELECT courses.*, 
                 l1.name as l1_name, l2.name as l2_name, l3.name as l3_name,
                 teachers.name as teacher_name, classrooms.name as classroom_name
          FROM courses
          LEFT JOIN course_level1 l1 ON courses.level1_id = l1.id
          LEFT JOIN course_level2 l2 ON courses.level2_id = l2.id
          LEFT JOIN course_level3 l3 ON courses.level3_id = l3.id
          LEFT JOIN teachers ON courses.teacher_id = teachers.id
          LEFT JOIN classrooms ON courses.classroom_id = classrooms.id
          ORDER BY courses.start_date ASC, courses.start_time ASC
        `;
        const { results } = await env.DB.prepare(query).all();
        return jsonRes(results);
      }

      // 區間週期排課：自動依照起訖日期與勾選星期產生個別上課日期紀錄
      if (path === '/api/courses/create-period' && method === 'POST') {
        const data = await request.json();
        const { level1_id, level2_id, level3_id, teacher_id, classroom_id, days, start_time, end_time, start_date, end_date } = data;
        
        if (!start_date || !end_date || !days || days.length === 0) {
          return jsonRes({ success: false, error: '請完整填寫日期區間與選擇星期' }, 400);
        }

        let curr = new Date(start_date);
        let end = new Date(end_date);
        let stmt = env.DB.prepare(`
          INSERT INTO courses (level1_id, level2_id, level3_id, name, teacher_id, classroom_id, day_of_week, start_time, end_time, start_date, end_date)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const l1Obj = await env.DB.prepare('SELECT name FROM course_level1 WHERE id = ?').bind(level1_id).first();
        const l2Obj = await env.DB.prepare('SELECT name FROM course_level2 WHERE id = ?').bind(level2_id).first();
        const l3Obj = await env.DB.prepare('SELECT name FROM course_level3 WHERE id = ?').bind(level3_id).first();
        const courseName = `${l1Obj?.name || ''}-${l2Obj?.name || ''}-${l3Obj?.name || ''}`;

        let batchQueries = [];
        while (curr <= end) {
          let jsDay = curr.getDay();
          let dbDay = jsDay === 0 ? 7 : jsDay;

          if (days.includes(dbDay)) {
            let dateStr = curr.toISOString().split('T')[0];
            batchQueries.push(stmt.bind(level1_id, level2_id, level3_id, courseName, teacher_id, classroom_id, dbDay, start_time, end_time, dateStr, dateStr));
          }
          curr.setDate(curr.getDate() + 1);
        }

        if (batchQueries.length > 0) {
          await env.DB.batch(batchQueries);
        }
        return jsonRes({ success: true, count: batchQueries.length });
      }

      // 3. 學生管理與 Excel 批次匯入、升降年級
      if (path === '/api/students' && method === 'GET') {
        const { results } = await env.DB.prepare('SELECT * FROM students ORDER BY id DESC').all();
        return jsonRes(results);
      }

      if (path === '/api/students/import' && method === 'POST') {
        const { students } = await request.json();
        let batch = [];
        for (let s of students) {
          batch.push(env.DB.prepare(`
            INSERT INTO students (chinese_name, english_name, gender, birth_date, school, grade, parent_name, parent_phone, password)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, '1234'))
          `).bind(s.chinese_name, s.english_name || '', s.gender || '', s.birth_date || '', s.school || '', s.grade || '', s.parent_name || '', s.parent_phone, s.password));
        }
        await env.DB.batch(batch);
        return jsonRes({ success: true, count: batch.length });
      }

      if (path === '/api/students/promote' && method === 'POST') {
        const { old_grade, new_grade } = await request.json();
        await env.DB.prepare('UPDATE students SET grade = ? WHERE grade = ?').bind(new_grade, old_grade).run();
        return jsonRes({ success: true });
      }

      // 4. 課程報名與個別費用調整
      if (path === '/api/enrollments' && method === 'GET') {
        const month = url.searchParams.get('month') || '2026-08';
        const query = `
          SELECT enrollments.*, students.chinese_name as student_name, students.grade, students.parent_phone,
                 courses.name as course_name, courses.start_date, courses.start_time
          FROM enrollments
          LEFT JOIN students ON enrollments.student_id = students.id
          LEFT JOIN courses ON enrollments.course_id = courses.id
          WHERE enrollments.enroll_month = ?
        `;
        const { results } = await env.DB.prepare(query).bind(month).all();
        return jsonRes(results);
      }

      if (path === '/api/enrollments/save' && method === 'POST') {
        const { student_id, course_id, enroll_month, fee } = await request.json();
        // 檢查是否已存在，存在則更新，不存在則新增
        const exist = await env.DB.prepare('SELECT id FROM enrollments WHERE student_id = ? AND course_id = ? AND enroll_month = ?').bind(student_id, course_id, enroll_month).first();
        if (exist) {
          await env.DB.prepare('UPDATE enrollments SET fee = ? WHERE id = ?').bind(fee, exist.id).run();
        } else {
          await env.DB.prepare('INSERT INTO enrollments (student_id, course_id, enroll_month, fee) VALUES (?, ?, ?, ?)').bind(student_id, course_id, enroll_month, fee).run();
        }
        return jsonRes({ success: true });
      }

      if (path === '/api/enrollments/copy-last' && method === 'POST') {
        const { target_month, source_month } = await request.json();
        const { results: oldEnrollments } = await env.DB.prepare('SELECT student_id, course_id, fee FROM enrollments WHERE enroll_month = ?').bind(source_month).all();
        
        let batch = [];
        for (let e of oldEnrollments) {
          batch.push(env.DB.prepare(`
            INSERT INTO enrollments (student_id, course_id, enroll_month, fee)
            VALUES (?, ?, ?, ?)
          `).bind(e.student_id, e.course_id, target_month, e.fee));
        }
        if (batch.length > 0) await env.DB.batch(batch);
        return jsonRes({ success: true, count: batch.length });
      }

      // 家長端登入
      if (path === '/api/parent/login' && method === 'POST') {
        const { phone, password } = await request.json();
        const student = await env.DB.prepare('SELECT * FROM students WHERE parent_phone = ? AND password = ?').bind(phone, password || '1234').first();
        if (student) {
          const enrollments = (await env.DB.prepare(`
            SELECT enrollments.fee, enroll_month, courses.* 
            FROM enrollments 
            LEFT JOIN courses ON enrollments.course_id = courses.id 
            WHERE enrollments.student_id = ?
          `).bind(student.id)).results;
          return jsonRes({ success: true, student, enrollments });
        }
        return jsonRes({ success: false, error: '手機號碼或密碼錯誤' }, 400);
      }

      return new Response('Not Found', { status: 404 });
    } catch (err) {
      return jsonRes({ success: false, error: err.message }, 500);
    }
  }
};