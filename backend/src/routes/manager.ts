// Store logins can only manage their own store's visits. Everything else is for admins.
import { Router } from 'express';
import { requireRole } from './auth.js';
import { visitRoutes } from './shared.js';

export function managerRoutes() {
  const r = Router();
  r.use(requireRole('STORE_MANAGER'));
  r.use(visitRoutes());
  return r;
}
