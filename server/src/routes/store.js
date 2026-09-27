import { Router } from 'express';
import { one, many, tx } from '../db.js';
import { requireAuth, staff } from '../auth.js';
import { HttpError } from '../logic.js';
import { h } from './core.js';

const r = Router();
r.use(requireAuth);

r.get('/products', h(async (req, res) => res.json(await many(`
  select id, category, name, subtitle, price_ils, case when media_id is null then null else '/api/media/' || media_id end url
  from products where studio_id=$1 and is_active and ($2::text is null or category::text=$2) order by category, name`, [req.user.studio_id, req.query.category || null]))));

r.get('/rewards', h(async (req, res) => res.json(await many(`
  select id, discount_pct, expires_at from rewards where member_id=$1 and used_at is null and discount_pct is not null and (expires_at is null or expires_at > now())
  order by discount_pct desc`, [req.user.id]))));

// items: [{product_id, qty}] · mock payment (succeeds immediately)
r.post('/orders', h(async (req, res) => {
  const { items = [], reward_id } = req.body || {};
  if (!items.length) throw new HttpError(400, 'empty_cart');
  const order = await tx(async (t) => {
    let subtotal = 0; const lines = [];
    for (const it of items) {
      const p = await t.one('select id, price_ils from products where id=$1 and studio_id=$2 and is_active', [it.product_id, req.user.studio_id]);
      const qty = parseInt(it.qty);
      if (!p || !(qty > 0)) throw new HttpError(400, 'bad_item');
      subtotal += Number(p.price_ils) * qty; lines.push({ id: p.id, qty, price: p.price_ils });
    }
    let discount = 0;
    if (reward_id) {
      const rw = await t.one('update rewards set used_at=now() where id=$1 and member_id=$2 and used_at is null and (expires_at is null or expires_at > now()) returning discount_pct', [reward_id, req.user.id]);
      if (rw) discount = Math.round(subtotal * rw.discount_pct) / 100;
    }
    const total = subtotal - discount;
    const pay = await t.one(`insert into payments(member_id, kind, amount_ils, status, provider) values ($1,'order',$2,'succeeded','mock') returning id`, [req.user.id, total]);
    const o = await t.one(`insert into orders(member_id, subtotal, discount, total, reward_id, payment_id) values ($1,$2,$3,$4,$5,$6) returning *`,
      [req.user.id, subtotal, discount, total, reward_id || null, pay.id]);
    for (const l of lines) await t.q('insert into order_items(order_id, product_id, qty, unit_price) values ($1,$2,$3,$4)', [o.id, l.id, l.qty, l.price]);
    return o;
  });
  res.json(order);
}));

r.get('/orders', h(async (req, res) => res.json(await many(`
  select o.*, (select jsonb_agg(jsonb_build_object('name',p.name,'qty',oi.qty,'price',oi.unit_price)) from order_items oi join products p on p.id=oi.product_id where oi.order_id=o.id) items
  from orders o where o.member_id=$1 order by o.created_at desc limit 50`, [req.user.id]))));

// reception: orders waiting for pickup
r.get('/staff/orders', staff, h(async (req, res) => res.json(await many(`
  select o.id, o.total, o.status, o.created_at, u.full_name,
    (select jsonb_agg(jsonb_build_object('name',p.name,'qty',oi.qty)) from order_items oi join products p on p.id=oi.product_id where oi.order_id=o.id) items
  from orders o join users u on u.id=o.member_id where u.studio_id=$1 and o.status in ('paid','ready') order by o.created_at`, [req.user.studio_id]))));
r.post('/staff/orders/:id/status', staff, h(async (req, res) => {
  const st = req.body?.status;
  if (!['ready', 'picked_up', 'cancelled'].includes(st)) throw new HttpError(400, 'bad_status');
  res.json(await one(`update orders o set status=$2 from users u where o.id=$1 and u.id=o.member_id and u.studio_id=$3 returning o.*`, [req.params.id, st, req.user.studio_id]));
}));

export default r;
