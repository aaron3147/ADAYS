export async function onRequestPost(context) {
  const db = context.env.DB;

  try {
    // 解析前端傳來的 JSON 資料
    const { studentId, classId } = await context.request.json();

    if (!studentId || !classId) {
      return new Response('缺少必要資訊', { status: 400 });
    }

    // 寫入 attendance 表
    const result = await db.prepare(
      'INSERT INTO attendance (student_id, class_id) VALUES (?, ?)'
    ).bind(studentId, classId).run();

    return new Response(JSON.stringify({ success: true, message: '簽到成功！' }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ success: false, error: '資料庫寫入失敗' }), { status: 500 });
  }
}