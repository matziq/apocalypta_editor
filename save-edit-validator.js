"use strict";
const Save = require("./save-format.js");

function prepareEdit(bytes, changes) {
  if (!Buffer.isBuffer(bytes) || bytes.length > Save.MAX_BYTES) throw new Error("Save exceeds the 20 MiB limit.");
  if (!changes || typeof changes !== "object" || Array.isArray(changes)) throw new Error("Expected a map of scalar edits.");
  if (!Object.keys(changes).length) throw new Error("No changes were provided.");
  const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  const edited = Buffer.from(Save.serialize(text, changes), "utf8");
  if (edited.length > Save.MAX_BYTES) throw new Error("Edited save exceeds the 20 MiB limit.");
  return edited;
}

if (require.main === module) {
  let input = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", chunk => {
    input += chunk;
    if (input.length > 30 * 1024 * 1024) {
      process.stderr.write("Validation input exceeds the size limit.");
      process.exit(1);
    }
  });
  process.stdin.on("end", () => {
    try {
      const request = JSON.parse(input);
      const bytes = Buffer.from(request.originalBase64, "base64");
      process.stdout.write(JSON.stringify({ contentBase64: prepareEdit(bytes, request.changes).toString("base64") }));
    } catch (error) {
      process.stdout.write(JSON.stringify({ error: error.message.slice(0, 1000) }));
      process.exitCode = 1;
    }
  });
}

module.exports = { prepareEdit };
