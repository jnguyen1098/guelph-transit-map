export function targetSettings(name) {
  if (name === 'baseline') return { ref: 'e0183aac2428c7d92f9dcb35a09f46c304e86fda', schedules: false };
  if (name === 'main') return { ref: 'refs/remotes/origin/main', schedules: true };
  if (name === 'pr18') return { ref: 'refs/remotes/origin/pr/18', schedules: true };
  throw Error(`Unknown target: ${name}; use baseline, main, or pr18`);
}
