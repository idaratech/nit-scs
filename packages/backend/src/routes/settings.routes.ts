import { Router } from 'express';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { authenticate } from '../middleware/auth.js';
import { requireRole } from '../middleware/rbac.js';
import { sendSuccess } from '../utils/response.js';

const router = Router();

const __dirname = dirname(fileURLToPath(import.meta.url));
const SETTINGS_PATH = join(__dirname, '../../data/settings.json');

const DEFAULT_SETTINGS = {
  vatRate: 15,
  currency: 'SAR',
  timezone: 'Asia/Riyadh',
  dateFormat: 'DD/MM/YYYY',
  overDeliveryTolerance: 10,
  backdateLimit: 7,
};

// GET /api/settings
router.get('/', authenticate, async (_req, res, next) => {
  try {
    const raw = await readFile(SETTINGS_PATH, 'utf-8').catch(() => null);
    sendSuccess(res, raw ? JSON.parse(raw) : DEFAULT_SETTINGS);
  } catch (err) {
    next(err);
  }
});

// PUT /api/settings
router.put('/', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const dir = dirname(SETTINGS_PATH);
    await mkdir(dir, { recursive: true });
    await writeFile(SETTINGS_PATH, JSON.stringify(req.body, null, 2));
    sendSuccess(res, req.body);
  } catch (err) {
    next(err);
  }
});

export default router;
