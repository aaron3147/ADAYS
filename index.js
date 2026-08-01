async function initDB(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS course_level1 (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT);`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS course_level2 (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, level1_id INTEGER);`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS course_level3 (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, level2_id INTEGER);`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS classrooms (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT);`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS teachers (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT);`).run();
  
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS students (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chinese_name TEXT,
      english_name TEXT,
      gender TEXT,
      birth_date TEXT,
      school TEXT,
      grade TEXT,
      parent_name TEXT,
      parent_phone TEXT,
      password TEXT DEFAULT '1234'
    );
  `).run();
  
  const cols = [
    'parent_phone TEXT', 'password TEXT DEFAULT "1234"', 'english_name TEXT', 
    'gender TEXT', 'birth_date TEXT', 'school TEXT', 'grade TEXT', 'parent_name TEXT'
  ];
  for (let col of cols) {
    try { await db.prepare(`ALTER TABLE students ADD COLUMN ${col};`).run(); } catch(e) {}
  }

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS courses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      level1_id INTEGER,
      level2_id INTEGER,
      level3_id INTEGER,
      name TEXT,
      teacher_id INTEGER,
      classroom_id INTEGER,
      day_of_week INTEGER,
      start_time TEXT,
      end_time TEXT,
      start_date TEXT,
      end_date TEXT
    );
  `).run();
  
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS enrollments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER,
      course_id INTEGER,
      enroll_month TEXT,
      fee INTEGER
    );
  `).run();
}

export default {
  async fetch(request, env, ctx) {
    await initDB(env.DB);
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    const jsonRes = (data, status = 200) => new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json' }
    });

    try {
      // 1. 教室管理 API
      if (path === '/api/classrooms') {
        if (method === 'GET') {
          const { results } = await env.DB.prepare('SELECT * FROM classrooms ORDER BY id ASC').all();
          return jsonRes(results);
        }
        if (method === 'POST') {
          const { name } = await request.json();
          await env.DB.prepare('INSERT INTO classrooms (name) VALUES (?)').bind(name).run();
          return jsonRes({ success: true });
        }
      }
      if (path.startsWith('/api/classrooms/') && method === 'DELETE') {
        const id = path.split('/')[3];
        await env.DB.prepare('DELETE FROM classrooms WHERE id = ?').bind(id).run();
        return jsonRes({ success: true });
      }

      // 2. 三層課程名稱管理 API
      if (path.startsWith('/api/levels/')) {
        const parts = path.split('/');
        const level = parts[3]; 
        const subAction = parts[4]; 

        if (method === 'GET') {
          if (level === 'level1') {
            const { results } = await env.DB.prepare('SELECT * FROM course_level1 ORDER BY id ASC').all();
            return jsonRes(results);
          } else if (level === 'level2') {
            const l1_id = url.searchParams.get('l1_id');
            const query = l1_id ? 'SELECT * FROM course_level2 WHERE level1_id = ? ORDER BY id ASC' : 'SELECT * FROM course_level2 ORDER BY id ASC';
            const stmt = l1_id ? env.DB.prepare(query).bind(l1_id) : env.DB.prepare(query);
            const { results } = await stmt.all();
            return jsonRes(results);
          } else if (level === 'level3') {
            const l2_id = url.searchParams.get('l2_id');
            const query = l2_id ? 'SELECT * FROM course_level3 WHERE level2_id = ? ORDER BY id ASC' : 'SELECT * FROM course_level3 ORDER BY id ASC';
            const stmt = l2_id ? env.DB.prepare(query).bind(l2_id) : env.DB.prepare(query);
            const { results } = await stmt.all();
            return jsonRes(results);
          }
        }

        if (method === 'POST') {
          const body = await request.json();
          if (level === 'level1') {
            await env.DB.prepare('INSERT INTO course_level1 (name) VALUES (?)').bind(body.name).run();
          } else if (level === 'level2') {
            await env.DB.prepare('INSERT INTO course_level2 (name, level1_id) VALUES (?, ?)').bind(body.name, body.level1_id).run();
          } else if (level === 'level3') {
            await env.DB.prepare('INSERT INTO course_level3 (name, level2_id) VALUES (?, ?)').bind(body.name, body.level2_id).run();
          }
          return jsonRes({ success: true });
        }

        if (method === 'PUT') {
          const body = await request.json();
          await env.DB.prepare(`UPDATE course_${level} SET name = ? WHERE id = ?`).bind(body.name, subAction).run();
          return jsonRes({ success: true });
        }

        if (method === 'DELETE') {
          await env.DB.prepare(`DELETE FROM course_${level} WHERE id = ?`).bind(subAction).run();
          return jsonRes({ success: true });
        }
      }

      if (path === '/api/meta' && method === 'GET') {
        const classrooms = (await env.DB.prepare('SELECT * FROM classrooms').all()).results;
        const teachers = (await env.DB.prepare('SELECT * FROM teachers').all()).results;
        return jsonRes({ classrooms, teachers });
      }

      // 3. 課程與防重複建立排課
      if (path === '/api/courses' && method === 'GET') {
        const query = `
          SELECT courses.*, 
                 teachers.name as teacher_name, classrooms.name as classroom_name
          FROM courses
          LEFT JOIN teachers ON courses.teacher_id = teachers.id
          LEFT JOIN classrooms ON courses.classroom_id = classrooms.id
          ORDER BY courses.start_date ASC, courses.start_time ASC
        `;
        const { results } = await env.DB.prepare(query).all();
        return jsonRes(results);
      }

      if (path.startsWith('/api/courses/') && method === 'DELETE') {
        const id = path.split('/')[3];
        await env.DB.prepare('DELETE FROM courses WHERE id = ?').bind(id).run();
        return jsonRes({ success: true });
      }

      if (path === '/api/courses/create-period' && method === 'POST') {
        const data = await request.json();
        const { level1_id, level2_id, level3_id, teacher_id, classroom_id, days, start_time, end_time, start_date, end_date } = data;
        
        let curr = new Date(start_date);
        let end = new Date(end_date);

        const l1Obj = await env.DB.prepare('SELECT name FROM course_level1 WHERE id = ?').bind(level1_id).first();
        const l2Obj = await env.DB.prepare('SELECT name FROM course_level2 WHERE id = ?').bind(level2_id).first();
        const l3Obj = await env.DB.prepare('SELECT name FROM course_level3 WHERE id = ?').bind(level3_id).first();
        const courseName = `${l1Obj?.name || ''} - ${l2Obj?.name || ''} - ${l3Obj?.name || ''}`;

        let batchQueries = [];
        let datesToCheck = [];
        let warnings = [];
        let skippedCount = 0;

        while (curr <= end) {
          let jsDay = curr.getDay();
          let dbDay = jsDay === 0 ? 7 : jsDay;
          if (days.includes(dbDay)) {
            datesToCheck.push({ dateStr: curr.toISOString().split('T')[0], dbDay });
          }
          curr.setDate(curr.getDate() + 1);
        }

        for (let item of datesToCheck) {
          // 檢查教室衝堂警告
          const { results: existing } = await env.DB.prepare(
            'SELECT courses.*, classrooms.name as c_name FROM courses LEFT JOIN classrooms ON courses.classroom_id = classrooms.id WHERE courses.classroom_id = ? AND courses.start_date = ?'
          ).bind(classroom_id, item.dateStr).all();

          for (let ex of existing) {
            if (start_time < ex.end_time && end_time > ex.start_time) {
              warnings.push(`衝堂警告：${item.dateStr} 該教室已被「${ex.name}」(${ex.start_time}~${ex.end_time}) 佔用！`);
            }
          }

          // 防重複檢查：同課程名、同教室、同日期、時間重疊者禁止重複建立
          const duplicateCheck = await env.DB.prepare(`
            SELECT id FROM courses 
            WHERE classroom_id = ? AND start_date = ? AND name = ? 
            AND (start_time < ? AND end_time > ?)
          `).bind(classroom_id, item.dateStr, courseName, end_time, start_time).first();

          if (duplicateCheck) {
            skippedCount++;
            continue; // 跳過不重複建立
          }

          let stmt = env.DB.prepare(`
            INSERT INTO courses (level1_id, level2_id, level3_id, name, teacher_id, classroom_id, day_of_week, start_time, end_time, start_date, end_date)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `);
          batchQueries.push(stmt.bind(level1_id, level2_id, level3_id, courseName, teacher_id, classroom_id, item.dbDay, start_time, end_time, item.dateStr, item.dateStr));
        }

        if (batchQueries.length > 0) {
          await env.DB.batch(batchQueries);
        }
        return jsonRes({ success: true, count: batchQueries.length, skippedCount, warnings });
      }

      // 4. 學生管理 (修復修改與刪除)
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
          `).bind(s.chinese_name, s.english_name || '', s.gender || '', s.birth_date || '', s.school || '', s.grade || '', s.parent_name || '', s.parent_phone || '', s.password || '1234'));
        }
        await env.DB.batch(batch);
        return jsonRes({ success: true, count: batch.length });
      }

      if (path.startsWith('/api/students/') && method === 'PUT') {
        const id = path.split('/')[3];
        const s = await request.json();
        await env.DB.prepare(`
          UPDATE students SET chinese_name=?, english_name=?, school=?, grade=?, parent_name=?, parent_phone=?, password=? WHERE id=?
        `).bind(s.chinese_name, s.english_name || '', s.school || '', s.grade || '', s.parent_name || '', s.parent_phone || '', s.password || '1234', id).run();
        return jsonRes({ success: true });
      }

      if (path.startsWith('/api/students/') && method === 'DELETE') {
        const id = path.split('/')[3];
        // 先刪除關聯的報名紀錄，避免外鍵限制導致刪除失敗
        await env.DB.prepare('DELETE FROM enrollments WHERE student_id = ?').bind(id).run();
        await env.DB.prepare('DELETE FROM students WHERE id = ?').bind(id).run();
        return jsonRes({ success: true });
      }

      if (path === '/api/students/promote' && method === 'POST') {
        const { old_grade, new_grade } = await request.json();
        await env.DB.prepare('UPDATE students SET grade = ? WHERE grade = ?').bind(new_grade, old_grade).run();
        return jsonRes({ success: true });
      }

      // 5. 課程報名與費用
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
        const exist = await env.DB.prepare('SELECT id FROM enrollments WHERE student_id = ? AND course_id = ? AND enroll_month = ?').bind(student_id, course_id, enroll_month).first();
        if (exist) {
          await env.DB.prepare('UPDATE enrollments SET fee = ? WHERE id = ?').bind(fee, exist.id).run();
        } else {
          await env.DB.prepare('INSERT INTO enrollments (student_id, course_id, enroll_month, fee) VALUES (?, ?, ?, ?)').bind(student_id, course_id, enroll_month, fee).run();
        }
        return jsonRes({ success: true });
      }

      if (path.startsWith('/api/enrollments/') && method === 'DELETE') {
        const id = path.split('/')[3];
        await env.DB.prepare('DELETE FROM enrollments WHERE id = ?').bind(id).run();
        return jsonRes({ success: true });
      }

      if (path === '/api/enrollments/copy-last' && method === 'POST') {
        const { target_month, source_month } = await request.json();
        const { results: oldEnrollments } = await env.DB.prepare('SELECT student_id, course_id, fee FROM enrollments WHERE enroll_month = ?').bind(source_month).all();
        let batch = [];
        for (let e of oldEnrollments) {
          batch.push(env.DB.prepare('INSERT INTO enrollments (student_id, course_id, enroll_month, fee) VALUES (?, ?, ?, ?)').bind(e.student_id, e.course_id, target_month, e.fee));
        }
        if (batch.length > 0) await env.DB.batch(batch);
        return jsonRes({ success: true, count: batch.length });
      }

      // 家長端登入
      if (path === '/api/parent/login' && method === 'POST') {
        const { phone, password } = await request.json();
        const cleanPhone = (phone || '').trim();
        const cleanPwd = (password || '1234').trim();
        const student = await env.DB.prepare('SELECT * FROM students WHERE TRIM(parent_phone) = ? AND (TRIM(password) = ? OR password IS NULL OR password = "")').bind(cleanPhone, cleanPwd).first();
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