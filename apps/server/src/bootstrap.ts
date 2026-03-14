import 'dotenv/config';
import { Bootstrap } from '@midwayjs/bootstrap';

Bootstrap.run().catch((err: unknown) => {
  console.error('[bootstrap] fatal:', err);
  process.exit(1);
});
