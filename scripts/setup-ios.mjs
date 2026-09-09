import { execSync } from 'node:child_process';

const run = (command) => {
  console.log(`\n$ ${command}`);
  execSync(command, { stdio: 'inherit', shell: true });
};

// Install the current Capacitor v8 packages and create the native iOS project.
// This intentionally runs locally so package-lock.json and ios/ are generated
// by the developer's package manager/Xcode environment rather than committed here.
run('npm install @capacitor/core@^8 @capacitor/ios@^8');
run('npm install -D @capacitor/cli@^8');
run('npm run build');
run('npx cap add ios');
run('npx cap sync ios');

console.log('\nCapacitor iOS project created successfully.');
console.log('Next: open ios/App/App.xcodeproj in Xcode and connect your iPhone.');
