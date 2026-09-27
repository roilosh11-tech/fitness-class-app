// AI workout builder — server-side Claude call. Needs ANTHROPIC_API_KEY.
import { HttpError } from './logic.js';

const BLOCKS = ['חימום', 'עיקרי', 'פיניש', 'שחרור'];
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';
const rid = () => Math.random().toString(36).slice(2, 10);

const planText = (p) => (p.blocks || []).map((b) =>
  `${b.name}: ${(b.items || []).map((i) => `${i.name} (${i.dose}${i.note ? ', ' + i.note : ''})`).join('; ') || '—'}`).join('\n');

async function claude(prompt) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new HttpError(503, 'ai_not_configured');
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: 1500, messages: [{ role: 'user', content: prompt }] }),
  });
  if (!r.ok) throw new HttpError(502, 'ai_upstream_' + r.status);
  const txt = (await r.json()).content?.[0]?.text || '';
  const s = txt.search(/[\[{]/), e = Math.max(txt.lastIndexOf('}'), txt.lastIndexOf(']'));
  return JSON.parse(txt.slice(s, e + 1));
}

// body: { mode: 'generate'|'refine'|'swap', plan: {name,focus,level,duration_min,blocks}, request?, item?: {block,name,dose} }
export async function aiWorkout({ mode, plan, request, item }) {
  if (!plan) throw new HttpError(400, 'plan_required');
  const prompt = mode === 'swap'
    ? `Suggest 3 quick alternative exercises to replace "${item?.name}" (${item?.dose}) in the ${item?.block} block of a ${plan.focus} small-group class (${plan.level}). Consider equipment limits and joint-friendliness. Answer in Hebrew. Return ONLY JSON array: [{"name":"...","dose":"3×8","why":"max 8 words"}]`
    : `You are an expert strength & fitness coach assistant helping a small-group studio coach write a workout plan.
Plan name: ${plan.name}. Focus: ${plan.focus}. Level: ${plan.level}. Duration: ${plan.duration_min} min. Group size up to 12.
Current plan:
${planText(plan) || '(empty)'}

Coach request: "${request || 'נסח אימון שלם ומאוזן לפי המיקוד והרמה'}"

Return ONLY JSON: {"summary":"one or two sentences on what you changed and why","blocks":[{"name":"חימום","items":[{"name":"exercise","dose":"3×8","note":"short cue"}]},{"name":"עיקרי","items":[]},{"name":"פיניש","items":[]},{"name":"שחרור","items":[]}]}
Keep exactly these 4 blocks with these exact Hebrew names. Write ALL text (summary, exercise names, doses, notes) in Hebrew. Doses short (e.g. "3×8 לצד", "2 דק׳", "3×30 מ׳"). Notes max 6 words. Realistic for the duration.`;

  let last;
  for (let i = 0; i < 2; i++) {
    try {
      const j = await claude(prompt);
      if (mode === 'swap') return { options: j.slice(0, 3).map((o) => ({ name: o.name, dose: o.dose, why: o.why })) };
      if (!j.blocks) throw new Error('no blocks');
      return {
        summary: j.summary || 'התוכנית עודכנה.',
        blocks: BLOCKS.map((n) => ({ name: n, items: ((j.blocks.find((b) => b.name === n) || {}).items || []).map((x) => ({ id: rid(), name: x.name, dose: x.dose || '', note: x.note || '' })) })),
      };
    } catch (e) { if (e instanceof HttpError) throw e; last = e; }
  }
  throw new HttpError(502, 'ai_parse_failed');
}
