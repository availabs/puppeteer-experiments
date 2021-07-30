import { mkdirSync } from 'fs';
import { join } from 'path';

const diskCacheDir = join(__dirname, '../../.disk-cache/');

mkdirSync(diskCacheDir, { recursive: true });

export default diskCacheDir;
