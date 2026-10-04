// This file runs on OUR computer every time the app is started or built
// (never on a phone). Its job: find out which version of the code is being
// built, and stamp that onto the app so we can see it on the home screen.
//
// "Which version" = the latest git commit, like "ea7c247". When somebody says
// "it's broken on my phone", that little code tells us exactly which code they have.

const { execSync } = require('child_process');

// Ask git a question and get the answer back as words.
// If git isn't around (for example, the code was downloaded as a zip), say "".
function askGit(question) {
  try {
    return execSync(`git ${question}`).toString().trim();
  } catch {
    return '';
  }
}

// The short name of the latest commit, like "ea7c247".
const commit = askGit('rev-parse --short HEAD') || 'unknown';

// Are there changes that haven't been committed yet? Then the app is NOT
// exactly that commit, so we add a "+" to be honest about it: "ea7c247+".
const hasUnsavedChanges = askGit('status --porcelain') !== '';

// "config" is everything already written in app.json. We keep all of it and
// add one extra thing: the version. The app reads it in src/app/index.tsx.
module.exports = ({ config }) => ({
  ...config,
  extra: {
    ...config.extra,
    version: commit + (hasUnsavedChanges ? '+' : ''),
  },
});
