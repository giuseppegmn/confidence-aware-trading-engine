import { runDemoScenario } from './demoEngine';

console.log('--- CATE Guided Demo ---');

console.log('\nScenario: UNSTABLE MARKET');
const unstable = runDemoScenario('UNSTABLE');
console.log(unstable);

console.log('\nScenario: STABLE MARKET');
const stable = runDemoScenario('STABLE');
console.log(stable);
