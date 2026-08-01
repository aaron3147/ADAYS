export async function onRequestGet(context) {
  // 取得綁定的 D1 資料庫
  const db = context.env.DB;
  
  // 從網址參數中取得學生 ID (例如 /api/student-classes?studentId=student_001)
  const url = new URL(context.request.url);
  const studentId = url.searchParams.get('studentId');

  if (!studentId) {
    return new Response('缺少 studentId', { status: 400 });
  }

  try {
    // 透過 SQL 關聯查詢，找出該學生報名的所有班別詳細資料
    const query = `
      SELECT classes.id, classes.name, classes.cost_per_session 
      FROM enrollments 
      JOIN classes ON enrollments.class_id = classes.id 
      WHERE enrollments.student_id = ?
    `;
    const { results } = await db.prepare(query).bind(studentId).all();

    // 將結果以 JSON 格式回傳給前端網頁
    return new Response(JSON.stringify(results), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}