import { Bootstrap } from '@midwayjs/core';
import { ContainerLifeCycle } from './configuration';

Bootstrap.run(ContainerLifeCycle).catch(err => {
  console.error('[bootstrap] fatal:', err);
  process.exit(1);
});
