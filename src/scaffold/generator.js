'use strict';

const fs = require('fs-extra');
const path = require('path');
const { getProjectFiles } = require('./templates');

/**
 * Generates a full Millas project at the given targetDir.
 */
async function generateProject(projectName, targetDir) {
  const files = getProjectFiles(projectName);

  for (const [filePath, content] of Object.entries(files)) {
    const fullPath = path.join(targetDir, filePath);
    await fs.ensureDir(path.dirname(fullPath));
    await fs.writeFile(fullPath, content, 'utf8');
  }

  // Create empty directories that need to exist but have no initial files
  const emptyDirs = [
    'storage/logs',
    'storage/uploads',
    'database/migrations',
    'database/seeders',
    'tests',
  ];

  for (const dir of emptyDirs) {
    await fs.ensureDir(path.join(targetDir, dir));
    await fs.writeFile(path.join(targetDir, dir, '.gitkeep'), '', 'utf8');
  }
}

module.exports = { generateProject };
