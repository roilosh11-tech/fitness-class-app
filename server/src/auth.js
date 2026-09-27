import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { one } from './db.js';

const SECRET = process.env.JWT_SECRET;
if (!SECRET || SECRET.length < 24) throw new Error('JWT_SECRET must be set (24+ random characters).');

export const hash = (pw) => bcrypt.hash(pw, 10);
export const check = (pw, h) => (h ? bcrypt.compare(pw, h) : false);
export const sign = (u) => jwt.sign({ sub: u.id, role: u.role, studio: u.studio_id }, SECRET, { expiresIn: '30d' });

export async function requireAuth(req, res, next) {
  if (req.user) return next();
  const tok = (req.headers.authorization || '').replace(/^Bearer /, '') || req.query.token;
  if (!tok) return res.status(401).json({ error: 'unauthorized' });
  try {
    const p = jwt.verify(tok, SECRET);
    const u = await one('select id, studio_id, role, full_name, email, theme, coach_title from users where id = $1', [p.sub]);
    if (!u) return res.status(401).json({ error: 'unauthorized' });
    req.user = u;
    next();
  } catch { res.status(401).json({ error: 'unauthorized' }); }
}

export const requireRole = (...roles) => (req, res, next) =>
  roles.includes(req.user.role) ? next() : res.status(403).json({ error: 'forbidden' });

export const staff = requireRole('coach', 'owner');
export const owner = requireRole('owner');
