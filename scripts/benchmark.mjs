import {writeFileSync} from 'node:fs';
import {fleetMeasurement} from '../test/fleet-measurement.mjs';
const cleanup=[];
try {
  const {report}=await fleetMeasurement({after: fn=>cleanup.push(fn)},50);
  const result={measuredAt:new Date().toISOString(),scope:'Synthetic loopback backend and real HAP serialization; not a live Home Control measurement',...report};
  console.log(JSON.stringify(result,null,2));
  if(process.argv.includes('--save'))writeFileSync(new URL('../docs/benchmark-results.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
}finally{for(const fn of cleanup.reverse())await fn();}
