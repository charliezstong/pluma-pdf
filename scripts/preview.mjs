import { main } from './local.mjs';

main('preview').catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
