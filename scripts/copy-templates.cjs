const fs = require("node:fs");
const path = require("node:path");

const source = path.join(__dirname, "..", "src", "app", "utils", "templates");
const target = path.join(__dirname, "..", "dist", "app", "utils", "templates");

if (!fs.existsSync(source)) {
  throw new Error(`Email template source directory not found: ${source}`);
}

fs.mkdirSync(target, { recursive: true });
fs.cpSync(source, target, { recursive: true });
console.log(`Copied email templates to ${target}`);
