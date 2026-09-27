// First-boot seed: studio, rooms, plans, class types, weekly timetable, coaches, store, prizes.
// Runs only when the database has no studio. Edit these values to match your real studio before first deploy
// (or change them later from the owner screens).
import { one, tx } from './db.js';

const STUDIO = 'FORM הירקון';
const ROOMS = ['סטודיו A', 'סטודיו B'];
const PLANS = [
  ['שיעור 1 בשבוע', '1 בשבוע', '4 קרדיטים בחודש', 79, 4, 1],
  ['2 שיעורים בשבוע', '2 בשבוע', '8 קרדיטים · הכי פופולרי', 129, 8, 2],
  ['ללא הגבלה', 'ללא הגבלה', 'מתאמנים כמה שרוצים', 179, null, 3],
];
// Coaches are created without a password. They activate by signing up with the same email.
const COACHES = [
  ['nina@formstudio.co.il', 'נינה פרץ', 'מאמנת כוח'],
  ['lior@formstudio.co.il', 'ליאור שגיא', 'מאמן מוביליטי'],
  ['amira@formstudio.co.il', 'אמירה עוזרי', 'מאמנת כושר'],
  ['shai@formstudio.co.il', 'שי קמחי', 'מאמן רפורמר'],
];
const TEMPLATES = [
  // name, type, description, capacity, room index, coach index, start time
  ['איפוס מוביליטי', 'Mobility', 'פתיחה של הירכיים, עמוד השדרה והכתפיים עם רצפי מוביליטי מודרכים. האיפוס המושלם לפני שבוע עמוס.', 12, 1, 1, '07:00'],
  ['זרימת רפורמר', 'Reformer', 'עבודת רפורמר בעצימות נמוכה לשליטה בליבה, ליציבה ולמרכז גוף חזק ויציב.', 10, 1, 0, '12:15'],
  ['יסודות הכוח', 'Strength', 'בונים תנועה בטוחה עם סקוואטים, נשיאות ולחיצות בהדרגה. מתאים לכל הרמות.', 12, 0, 0, '18:00'],
  ['מעגל כושר', 'Conditioning', 'תחנות בקצב גבוה עם קטלבלס, חתירה ותרגילי משקל גוף. משאירים הכל על הרצפה.', 12, 0, 2, '19:15'],
];
const DAYS = [0, 1, 2, 3, 4, 5]; // Sun–Fri
const PRODUCTS = [
  ['Protein', 'חלבון מי גבינה · וניל', '900 גר׳ · 30 מנות', 189], ['Protein', 'חלבון צמחי · קקאו', '1 ק״ג · טבעוני', 169],
  ['Protein', 'חטיפי חלבון · מארז 12', '20 גר׳ חלבון בכל חטיף', 99], ['Protein', 'קריאטין מונוהידרט', '300 גר׳ · ללא טעם', 95],
  ['Accessories', 'סט גומיות התנגדות', '5 רמות', 85], ['Accessories', 'רצועות הרמה', 'כותנה מרופדת', 65],
  ['Accessories', 'שייקר FORM', '700 מ״ל · נירוסטה', 59], ['Accessories', 'חבל קפיצה מהיר', 'מתכוונן', 55],
  ['Apparel', 'חולצת אימון FORM', 'פוליאסטר ממוחזר', 119], ['Apparel', 'גרבי רפורמר מונעות החלקה', '2 זוגות', 49],
  ['Sessions', 'אימון אישי 1:1', '60 דק׳ · כל מאמן/ת', 320], ['Sessions', 'אימון שחרור', '30 דק׳ מתיחות', 140],
];
const PRIZES = [
  ['week', 1, '20% הנחה בחנות FORM', 'חלבונים, אביזרים וביגוד', 20], ['week', 2, 'אימון שחרור חינם', '30 דק׳ מתיחות ואקדח עיסוי', null],
  ['week', 3, '10% הנחה בחנות FORM', 'בתוקף ל-7 ימים', 10], ['month', 1, 'אימון אישי 1:1 חינם', '60 דק׳ עם המאמן/ת לבחירתך', null],
  ['month', 2, '2 כרטיסי חבר/ה', 'ושייק חלבון מתנה לכל אחד', null], ['month', 3, 'עדיפות בהזמנה', 'הזמנה 24 שעות לפני כולם בחודש הבא', null],
];

export async function seedIfEmpty() {
  if (await one('select id from studios limit 1')) return;
  await tx(async (t) => {
    const st = (await t.one('insert into studios(name) values ($1) returning id', [STUDIO])).id;
    const rooms = [];
    for (const n of ROOMS) rooms.push((await t.one('insert into rooms(studio_id, name) values ($1,$2) returning id', [st, n])).id);
    for (const [i, p] of PLANS.entries())
      await t.q('insert into plans(studio_id, name, short_name, subtitle, price_ils, monthly_credits, weekly_goal, sort) values ($1,$2,$3,$4,$5,$6,$7,$8)', [st, ...p, i]);
    const coaches = [];
    for (const [email, name, title] of COACHES)
      coaches.push((await t.one(`insert into users(studio_id, email, full_name, role, coach_title) values ($1,$2,$3,'coach',$4) returning id`, [st, email, name, title])).id);
    for (const [name, type, desc, cap, ri, ci, time] of TEMPLATES) {
      const tp = (await t.one('insert into class_templates(studio_id, name, type, description, default_capacity) values ($1,$2,$3,$4,$5) returning id', [st, name, type, desc, cap])).id;
      for (const d of DAYS)
        await t.q('insert into weekly_slots(studio_id, template_id, dow, start_time, room_id, coach_id, capacity) values ($1,$2,$3,$4,$5,$6,$7)', [st, tp, d, time, rooms[ri], coaches[ci], cap]);
    }
    for (const p of PRODUCTS) await t.q('insert into products(studio_id, category, name, subtitle, price_ils) values ($1,$2,$3,$4,$5)', [st, ...p]);
    for (const p of PRIZES) await t.q('insert into prizes(studio_id, period, rank, title, subtitle, discount_pct) values ($1,$2,$3,$4,$5,$6)', [st, ...p]);
  });
  console.log('seeded studio');
}
