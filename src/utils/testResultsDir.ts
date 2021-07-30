import { mkdirSync } from 'fs';
import { join } from 'path';

const testResultsDir = join(__dirname, '../../testResults/');

mkdirSync(testResultsDir, { recursive: true });

export default testResultsDir;
